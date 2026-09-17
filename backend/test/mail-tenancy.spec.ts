import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BillingCycle, PrismaClient, Realm } from '@prisma/client';
import { ActivityService } from '../src/activity/activity.service';
import { TenantScope } from '../src/common/tenant-scope';
import { PlanLimitsService } from '../src/plans/plan-limits.service';
import { MailDomainsService } from '../src/mail/mail-domains.service';
import { MailboxesService } from '../src/mail/mailboxes.service';
import { AliasesService } from '../src/mail/aliases.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { CustomerPrincipal } from '../src/common/principal';

/**
 * Mail tenancy and plan limits, against the real database.
 *
 * Mail is where a tenancy mistake is worst: a mailbox holds someone's
 * correspondence, and a domain claimed by the wrong customer means their mail is
 * delivered to a stranger. `Mailbox` has no `customerId` of its own — its tenant
 * is the domain's — so the property under test is that there is no way to reach
 * one except through a domain the caller owns.
 */
describe('mail tenancy', () => {
  const prisma = new PrismaClient() as PrismaService;
  const activity = new ActivityService(prisma);
  const scope = new TenantScope(prisma);
  const limits = new PlanLimitsService(prisma);
  const domains = new MailDomainsService(prisma, activity, scope);
  const mailboxes = new MailboxesService(prisma, activity, domains, limits);
  const aliases = new AliasesService(prisma, activity, domains);

  const suffix = Date.now().toString(36);
  const PASSWORD = 'a-long-enough-password';

  let customerA: string;
  let customerB: string;
  let domainA: string;
  let domainB: string;
  let planId: string;
  let principalA: CustomerPrincipal;
  let principalB: CustomerPrincipal;

  const principalFor = async (customerId: string, label: string): Promise<CustomerPrincipal> => {
    const role = await prisma.role.findFirstOrThrow({
      where: { realm: Realm.CUSTOMER, name: 'CUSTOMER' },
    });
    const user = await prisma.customerUser.create({
      data: {
        customerId,
        email: `${label}-${suffix}@isolation.test`,
        fullName: label,
        passwordHash: 'x',
        roleId: role.id,
        status: 'ACTIVE',
      },
    });

    return {
      realm: Realm.CUSTOMER,
      userId: user.id,
      customerId,
      email: user.email,
      roleId: role.id,
      roleName: 'CUSTOMER',
      permissions: new Set(['email.view', 'email.create', 'email.update', 'email.delete']),
    };
  };

  /** Activated directly: DNS verification is exercised on its own, below. */
  const activeDomain = async (customerId: string, name: string) => {
    const domain = await prisma.mailDomain.create({
      data: {
        customerId,
        name,
        status: 'ACTIVE',
        verifiedAt: new Date(),
        verificationToken: MailDomainsService.newToken(),
      },
    });
    return domain.id;
  };

  beforeAll(async () => {
    await prisma.$connect();

    const plan = await prisma.hostingPlan.create({
      data: {
        name: 'Mail Test',
        slug: `mail-test-${suffix}`,
        priceInPaise: 100_000,
        billingCycle: BillingCycle.YEARLY,
        maxMailboxes: 50,
      },
    });
    planId = plan.id;

    const a = await prisma.customer.create({
      data: { fullName: 'Mail A', email: `mail-a-${suffix}@isolation.test`, status: 'ACTIVE' },
    });
    const b = await prisma.customer.create({
      data: { fullName: 'Mail B', email: `mail-b-${suffix}@isolation.test`, status: 'ACTIVE' },
    });
    customerA = a.id;
    customerB = b.id;

    for (const customerId of [customerA, customerB]) {
      await prisma.subscription.create({
        data: { customerId, planId, status: 'ACTIVE', renewsAt: new Date('2099-01-01') },
      });
    }

    domainA = await activeDomain(customerA, `a-mail-${suffix}.test`);
    domainB = await activeDomain(customerB, `b-mail-${suffix}.test`);

    principalA = await principalFor(customerA, 'user-a');
    principalB = await principalFor(customerB, 'user-b');
  });

  afterAll(async () => {
    await prisma.mailDomain.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.subscription.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.customerUser.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerA, customerB] } } });
    await prisma.hostingPlan.deleteMany({ where: { id: planId } });
    await prisma.$disconnect();
  });

  describe('reaching another customer', () => {
    it("reports another customer's mail domain as not found", async () => {
      await expect(domains.get(principalA, domainB)).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
    });

    /**
     * The property that matters most here. A mailbox carries no tenant of its
     * own, so the only thing standing between Customer A and Customer B's mail
     * is that every method resolves the domain first.
     */
    it("cannot list, create, or reach a mailbox on another customer's domain", async () => {
      await expect(mailboxes.list(principalA, domainB)).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
      await expect(
        mailboxes.create(principalA, domainB, { localPart: 'intruder', password: PASSWORD }),
      ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
      await expect(aliases.list(principalA, domainB)).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
    });

    it("cannot reach a mailbox by pairing its real id with a domain it owns", async () => {
      const theirs = await mailboxes.create(principalB, domainB, {
        localPart: 'private',
        password: PASSWORD,
      });

      // The id is real and the domain is genuinely Customer A's. The lookup is
      // on the pair, so it still finds nothing.
      await expect(
        mailboxes.update(principalA, domainA, theirs.id, { displayName: 'hijacked' }),
      ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });

      await expect(
        mailboxes.setPassword(principalA, domainA, theirs.id, 'another-long-password'),
      ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    });

    it('refuses to let a second customer claim a domain, without saying who holds it', async () => {
      const name = `contested-${suffix}.test`;
      await domains.add(principalA, customerA, name);

      const refusal = await domains
        .add(principalB, customerB, name)
        .catch((e: { response: { code: string; message: string } }) => e.response);

      expect(refusal.code).toBe('CONFLICT');
      // Naming the holder would confirm which domains are WebEdge customers,
      // and whose.
      expect(refusal.message).not.toContain('Mail A');
      expect(refusal.message).not.toContain(`mail-a-${suffix}`);
    });
  });

  describe('a domain that has not proved ownership', () => {
    /**
     * Until control is proved, one customer could add another's domain and start
     * receiving their mail. Nothing may be built on it.
     */
    it('accepts no mailboxes and no aliases', async () => {
      const pending = await domains.add(principalA, customerA, `pending-${suffix}.test`);

      await expect(
        mailboxes.create(principalA, pending.id, { localPart: 'early', password: PASSWORD }),
      ).rejects.toMatchObject({ response: { code: 'CONFLICT' } });

      await expect(
        aliases.create(principalA, pending.id, {
          localPart: 'early',
          destinations: [`someone@elsewhere-${suffix}.test`],
        }),
      ).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
    });

    it('publishes a challenge that is unguessable and specific to the domain', async () => {
      const first = await domains.add(principalA, customerA, `challenge-1-${suffix}.test`);
      const second = await domains.add(principalA, customerA, `challenge-2-${suffix}.test`);

      const a = domains.challenge(first);
      const b = domains.challenge(second);

      expect(a.host).toBe(`_webedge-challenge.challenge-1-${suffix}.test`);
      expect(a.value).not.toBe(b.value);
      expect(a.value.length).toBeGreaterThan(30);
    });

    it('reports a domain with no published record rather than activating it', async () => {
      const pending = await domains.add(principalA, customerA, `unpublished-${suffix}.invalid`);

      // `.invalid` never resolves, by RFC 2606 — so this exercises the real
      // resolver without depending on anything outside the machine.
      await expect(domains.verify(principalA, pending.id)).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });

      const after = await prisma.mailDomain.findUniqueOrThrow({ where: { id: pending.id } });
      expect(after.status).toBe('PENDING_VERIFICATION');
      expect(after.verifiedAt).toBeNull();
    });
  });

  describe('what a mailbox may be called', () => {
    it('refuses a local part that would traverse a maildir path', async () => {
      for (const localPart of ['../../etc', 'a/b', 'a..b', '.hidden']) {
        await expect(
          mailboxes.create(principalA, domainA, { localPart, password: PASSWORD }),
          localPart,
        ).rejects.toMatchObject({ response: { code: 'INVALID_REQUEST' } });
      }
    });

    /**
     * `postmaster` and `abuse` must reach someone who can act on a report, and
     * the addresses a certificate authority accepts as proof of domain control
     * must not go to whoever claims them first.
     */
    it('refuses the reserved names', async () => {
      for (const localPart of ['postmaster', 'abuse', 'ssladmin']) {
        await expect(
          mailboxes.create(principalA, domainA, { localPart, password: PASSWORD }),
          localPart,
        ).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
      }
    });

    it('refuses a password short enough to guess', async () => {
      await expect(
        mailboxes.create(principalA, domainA, { localPart: 'weak', password: 'short' }),
      ).rejects.toThrow(/at least 12/);
    });
  });

  describe('what a mailbox returns', () => {
    /** The hash is not something any response has a reason to carry. */
    it('never includes the password hash', async () => {
      const created = await mailboxes.create(principalA, domainA, {
        localPart: 'visible',
        password: PASSWORD,
      });
      const listed = await mailboxes.list(principalA, domainA);

      expect(created).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(listed)).not.toContain('ARGON2ID');
      expect(JSON.stringify(listed)).not.toContain('argon2');
    });

    it('records the change in the trail without the password', async () => {
      const created = await mailboxes.create(principalA, domainA, {
        localPart: 'audited',
        password: PASSWORD,
      });

      const entry = await prisma.activityLog.findFirstOrThrow({
        where: { resourceId: created.id, action: 'mail.mailbox.created' },
      });

      expect(JSON.stringify(entry)).not.toContain(PASSWORD);
      expect(JSON.stringify(entry)).not.toContain('argon2');
    });
  });

  describe('mailboxes and aliases cannot shadow each other', () => {
    /**
     * A mailbox wins over an alias at delivery. An alias behind one would never
     * fire, which reads as mail being forwarded when it simply is not.
     */
    it('refuses an alias where a mailbox already exists', async () => {
      await mailboxes.create(principalA, domainA, { localPart: 'shadowed', password: PASSWORD });

      await expect(
        aliases.create(principalA, domainA, {
          localPart: 'shadowed',
          destinations: [`elsewhere@other-${suffix}.test`],
        }),
      ).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
    });

    it('refuses a mailbox where an alias already exists', async () => {
      await aliases.create(principalA, domainA, {
        localPart: 'taken',
        destinations: [`elsewhere@other-${suffix}.test`],
      });

      await expect(
        mailboxes.create(principalA, domainA, { localPart: 'taken', password: PASSWORD }),
      ).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
    });
  });

  describe('alias loops', () => {
    it('refuses a cycle at the point it would be created', async () => {
      const name = (await prisma.mailDomain.findUniqueOrThrow({ where: { id: domainA } })).name;

      await aliases.create(principalA, domainA, {
        localPart: 'loop-one',
        destinations: [`loop-two@${name}`],
      });

      await expect(
        aliases.create(principalA, domainA, {
          localPart: 'loop-two',
          destinations: [`loop-one@${name}`],
        }),
      ).rejects.toMatchObject({ response: { code: 'CONFLICT' } });

      // And the cycle does not exist: the second alias was never written.
      const written = await prisma.mailAlias.findUnique({
        where: { domainId_localPart: { domainId: domainA, localPart: 'loop-two' } },
      });
      expect(written).toBeNull();
    });

    it('traces where an address actually delivers', async () => {
      const name = (await prisma.mailDomain.findUniqueOrThrow({ where: { id: domainA } })).name;
      await mailboxes.create(principalA, domainA, { localPart: 'traced', password: PASSWORD });
      await aliases.create(principalA, domainA, {
        localPart: 'traced-alias',
        destinations: [`traced@${name}`],
      });

      const result = await aliases.trace(principalA, domainA, `traced-alias@${name}`);
      expect(result.deliverTo).toEqual([`traced@${name}`]);
      expect(result.loop).toBeNull();
    });
  });

  describe('plan limits', () => {
    /**
     * `maxMailboxes` has been on `HostingPlan` since the schema was written and
     * `PLAN_LIMIT_REACHED` has been in the error catalogue just as long, with
     * nothing throwing it — there was no creation path to guard until now.
     */
    it('refuses a mailbox past the plan allowance', async () => {
      // A plan of its own, so the allowance cannot be spent by another test.
      const tight = await prisma.hostingPlan.create({
        data: {
          name: 'Two Mailboxes',
          slug: `tight-mail-${suffix}`,
          priceInPaise: 100_000,
          billingCycle: BillingCycle.YEARLY,
          maxMailboxes: 2,
        },
      });
      await prisma.subscription.updateMany({
        where: { customerId: customerB },
        data: { planId: tight.id },
      });
      await prisma.mailbox.deleteMany({ where: { domain: { customerId: customerB } } });

      const first = await activeDomain(customerB, `limits-one-${suffix}.test`);
      const second = await activeDomain(customerB, `limits-two-${suffix}.test`);

      await mailboxes.create(principalB, first, { localPart: 'one', password: PASSWORD });
      // The second goes on a different domain, because the allowance is per
      // customer and not per domain — which is the next test.
      await mailboxes.create(principalB, second, { localPart: 'two', password: PASSWORD });

      const refusal = await mailboxes
        .create(principalB, first, { localPart: 'one-too-many', password: PASSWORD })
        .catch((e: { response: { code: string; details: Record<string, unknown> } }) => e.response);

      expect(refusal.code).toBe('PLAN_LIMIT_REACHED');
      // The numbers travel in details so the UI can offer an upgrade without
      // parsing the sentence.
      expect(refusal.details).toMatchObject({ limit: 2, used: 2, resource: 'maxMailboxes' });

      const state = await limits.state(customerB, 'maxMailboxes');
      expect(state.used, 'the allowance is counted across every domain').toBe(2);
      expect(state.remaining).toBe(0);

      await prisma.subscription.updateMany({
        where: { customerId: customerB },
        data: { planId },
      });
      await prisma.hostingPlan.delete({ where: { id: tight.id } });
    });

    /**
     * An absent plan is a reason to refuse, not to permit. Treating it as
     * unlimited is how a cancelled account keeps consuming.
     */
    it('treats a customer with no active plan as having no allowance', async () => {
      const orphan = await prisma.customer.create({
        data: {
          fullName: 'No Plan',
          email: `no-plan-${suffix}@isolation.test`,
          status: 'ACTIVE',
        },
      });

      const state = await limits.state(orphan.id, 'maxMailboxes');
      expect(state.limit).toBe(0);
      await expect(limits.assertCanCreate(orphan.id, 'maxMailboxes')).rejects.toMatchObject({
        response: { code: 'PLAN_LIMIT_REACHED' },
      });

      await prisma.customer.delete({ where: { id: orphan.id } });
    });

    /** Null is unlimited, and only null. There is no default to fall back to. */
    it('lets an unlimited plan through', async () => {
      const unlimited = await prisma.hostingPlan.create({
        data: {
          name: 'Unlimited Mail',
          slug: `unlimited-mail-${suffix}`,
          priceInPaise: 999_900,
          billingCycle: BillingCycle.YEARLY,
          maxMailboxes: null,
        },
      });
      await prisma.subscription.updateMany({
        where: { customerId: customerA },
        data: { planId: unlimited.id },
      });

      const state = await limits.state(customerA, 'maxMailboxes');
      expect(state.limit).toBeNull();
      expect(state.remaining).toBeNull();
      await expect(limits.assertCanCreate(customerA, 'maxMailboxes')).resolves.toBeTruthy();

      await prisma.subscription.updateMany({ where: { customerId: customerA }, data: { planId } });
      await prisma.hostingPlan.delete({ where: { id: unlimited.id } });
    });
  });

  describe('deleting', () => {
    it('requires the address typed back', async () => {
      const mailbox = await mailboxes.create(principalA, domainA, {
        localPart: 'deletable',
        password: PASSWORD,
      });

      await expect(
        mailboxes.remove(principalA, domainA, mailbox.id, 'deletable'),
      ).rejects.toMatchObject({ response: { code: 'INVALID_REQUEST' } });

      const result = await mailboxes.remove(principalA, domainA, mailbox.id, mailbox.address);
      expect(result.removed).toBe(true);
    });

    /** An alias left pointing at a deleted mailbox stops delivering silently. */
    it('names the aliases a deletion leaves pointing nowhere', async () => {
      const name = (await prisma.mailDomain.findUniqueOrThrow({ where: { id: domainA } })).name;
      const mailbox = await mailboxes.create(principalA, domainA, {
        localPart: 'pointed-at',
        password: PASSWORD,
      });
      await aliases.create(principalA, domainA, {
        localPart: 'points-here',
        destinations: [`pointed-at@${name}`],
      });

      const result = await mailboxes.remove(principalA, domainA, mailbox.id, mailbox.address);
      expect(result.orphanedAliases).toContain(`points-here@${name}`);
    });
  });
});
