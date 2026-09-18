import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BillingCycle, PrismaClient } from '@prisma/client';
import { ActivityService } from '../src/activity/activity.service';
import { InvoiceService } from '../src/billing/invoice.service';
import { PlansService } from '../src/plans/plans.service';
import { SubscriptionsService } from '../src/plans/subscriptions.service';
import { RenewalsService } from '../src/plans/renewals.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AdminPrincipal } from '../src/common/principal';

/**
 * The renewal sweep, against the real database.
 *
 * Before this worker existed, `renewsAt` was a date nothing read: a
 * subscription passed it, no invoice was raised, the service kept working, and
 * a cancelled customer kept their hosting indefinitely. So the first property
 * here is simply that renewals happen.
 *
 * The rest are about not happening twice. An issued invoice cannot be deleted —
 * a charge that should not exist is corrected only by a credit note against it,
 * which leaves both documents in the customer's records and in the GST return.
 * So "charged once" is not a quality goal here, it is the thing the design is
 * for, and it is asserted under a retry, under an interrupted run, and under
 * concurrent sweeps.
 *
 * Everything runs against real Postgres, because the guarantee is a unique
 * index. A mock would assert that the code calls what it calls.
 */
describe('renewal worker', () => {
  const prisma = new PrismaClient() as PrismaService;
  const activity = new ActivityService(prisma);
  const invoices = new InvoiceService(prisma, activity);
  const plans = new PlansService(prisma, activity);
  const subscriptions = new SubscriptionsService(prisma, activity, invoices);
  const renewals = new RenewalsService(prisma, activity, subscriptions);

  const suffix = Date.now().toString(36);
  let customerId: string;
  let planId: string;

  const principal: AdminPrincipal = {
    realm: 'ADMIN',
    userId: '00000000-0000-4000-8000-00000000000a',
    email: 'admin@webedgesolution.com',
    roleId: '00000000-0000-4000-8000-00000000000b',
    roleName: 'SUPER_ADMIN',
    permissions: new Set<string>(),
  };

  const DAY = 24 * 60 * 60 * 1000;

  /** A subscription already past its renewal date, ready to be swept. */
  async function overdueSubscription(options: {
    daysOverdue?: number;
    autoRenew?: boolean;
    cancelledAt?: Date | null;
  } = {}) {
    const renewsAt = new Date(Date.now() - (options.daysOverdue ?? 1) * DAY);
    // A yearly plan anchored one year before the renewal date, so the next
    // renewal is a clean anniversary.
    const startsAt = new Date(renewsAt.getTime());
    startsAt.setUTCFullYear(startsAt.getUTCFullYear() - 1);

    return prisma.subscription.create({
      data: {
        customerId,
        planId,
        status: 'ACTIVE',
        startsAt,
        renewsAt,
        autoRenew: options.autoRenew ?? true,
        cancelledAt: options.cancelledAt ?? null,
      },
    });
  }

  const invoicesFor = (subscriptionId: string) =>
    prisma.invoice.findMany({ where: { subscriptionId }, orderBy: { serialNumber: 'asc' } });

  /**
   * Everything billed to this customer, however it was tagged.
   *
   * The count that matters is what the customer is asked to pay, not what
   * carries the right key — an invoice issued without the period key is still
   * a charge on their account. Asserting on the tagged rows alone would let the
   * very regression these tests exist for pass as "zero duplicates".
   */
  const allInvoices = () =>
    prisma.invoice.findMany({ where: { customerId }, orderBy: { serialNumber: 'asc' } });

  beforeAll(async () => {
    await prisma.$connect();

    const customer = await prisma.customer.create({
      data: {
        fullName: 'Renewal Co',
        email: `renewal-${suffix}@isolation.test`,
        status: 'ACTIVE',
        billingState: '27',
      },
    });
    customerId = customer.id;

    const plan = await plans.create(principal, {
      name: 'Starter',
      slug: `renewal-starter-${suffix}`,
      priceInPaise: 120_000,
      billingCycle: BillingCycle.YEARLY,
      maxWebsites: 1,
      providerProduct: 'shared-single',
    });
    planId = plan.id;
  });

  afterEach(async () => {
    // Each test owns the whole customer's billing state, because the sweep is a
    // whole-table operation and a leftover subscription from one test is real
    // work for the next one's sweep.
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.subscription.deleteMany({ where: { customerId } });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { customerId } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    // The trail is deliberately not cleaned up: `activity_logs` is append-only
    // via a database trigger, and a DELETE here is refused. The rows survive
    // the customer, which is the property `activity-log-durability.spec.ts`
    // exists to prove.
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.hostingPlan.deleteMany({ where: { id: planId } });
    await prisma.$disconnect();
  });

  describe('renewing what is due', () => {
    it('invoices an overdue subscription and advances the period', async () => {
      const subscription = await overdueSubscription({ daysOverdue: 2 });

      const summary = await renewals.sweep();

      expect(summary.renewed.map((r) => r.subscriptionId)).toContain(subscription.id);

      const issued = await invoicesFor(subscription.id);
      expect(issued).toHaveLength(1);
      expect(issued[0]?.status).toBe('ISSUED');
      expect(issued[0]?.periodStart?.toISOString()).toBe(subscription.renewsAt.toISOString());

      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(after.renewsAt.getTime()).toBeGreaterThan(subscription.renewsAt.getTime());
    });

    /**
     * Renewing late must not move the anniversary. A subscription swept five
     * days after it was due is still due on its original day next year —
     * otherwise the date walks forward every cycle and the customer gets days
     * nobody charged for.
     */
    it('keeps the anniversary when the sweep runs late', async () => {
      const subscription = await overdueSubscription({ daysOverdue: 5 });

      await renewals.sweep();

      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(after.renewsAt.getUTCDate()).toBe(subscription.renewsAt.getUTCDate());
      expect(after.renewsAt.getUTCMonth()).toBe(subscription.renewsAt.getUTCMonth());
      expect(after.renewsAt.getUTCFullYear()).toBe(subscription.renewsAt.getUTCFullYear() + 1);
    });

    it('leaves a subscription that is not due yet alone', async () => {
      const subscription = await prisma.subscription.create({
        data: {
          customerId,
          planId,
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 30 * DAY),
          renewsAt: new Date(Date.now() + 30 * DAY),
        },
      });

      await renewals.sweep();

      expect(await invoicesFor(subscription.id)).toHaveLength(0);
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(after.renewsAt.toISOString()).toBe(subscription.renewsAt.toISOString());
    });

    /** Auto-renew off means the customer intends to pay by hand, not that they left. */
    it('does not renew a subscription with auto-renew switched off', async () => {
      const subscription = await overdueSubscription({ autoRenew: false });

      await renewals.sweep();

      expect(await invoicesFor(subscription.id)).toHaveLength(0);
    });
  });

  describe('charging exactly once', () => {
    it('charges once when the sweep runs twice', async () => {
      const subscription = await overdueSubscription();

      await renewals.sweep();
      await renewals.sweep();
      await renewals.sweep();

      expect(await invoicesFor(subscription.id)).toHaveLength(1);
      expect(await allInvoices()).toHaveLength(1);
    });

    /**
     * The property the design exists for.
     *
     * Ten sweeps at once is what two application instances on the same timer
     * look like, and what a retry after a gateway timeout looks like. The
     * guarantee is the unique index on `(subscriptionId, periodStart)`, not the
     * ordering of these promises — which is why this is worth asserting
     * against a real database rather than reasoning about.
     *
     * Seen to fail, not assumed: dropping `forPeriod` from the renewal's call
     * to `issue` — the state of the code before this worker — produced ten
     * invoices for one period on this exact test, billing ₹14,160 for a ₹1,416
     * renewal. That is why the count below is taken over the customer's whole
     * account rather than over rows carrying the period key: the regression
     * removes the key, so a count filtered by it would read zero duplicates.
     */
    it('charges once when ten sweeps run concurrently', async () => {
      const subscription = await overdueSubscription();

      await Promise.all(Array.from({ length: 10 }, () => renewals.sweep()));

      const issued = await invoicesFor(subscription.id);
      expect(issued).toHaveLength(1);
      // Counted on the customer's account, not on the key: an invoice written
      // without the period key is still money they are asked for.
      expect(await allInvoices()).toHaveLength(1);

      // And the period advanced exactly one cycle, not ten.
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(after.renewsAt.getUTCFullYear()).toBe(subscription.renewsAt.getUTCFullYear() + 1);
    });

    /**
     * The bug the ten-sweep test above only caught intermittently, made
     * deterministic.
     *
     * `renewDue` lists what is due and then renews each row one at a time, and
     * `renew` re-reads the row. Between the list and the read, another sweep
     * can advance the date. The stale caller then invoices for the period that
     * has *not started yet* — a different `periodStart`, so a different key,
     * so the unique index has no reason to refuse it. A second charge, dated a
     * full cycle into the future.
     *
     * A long batch is what opens the window, which is why this fills one: with
     * a single subscription the loop is over before any other sweep reaches it,
     * and the whole thing passes while being wrong. Against an empty table the
     * original test failed roughly two runs in five; with this batch it fails
     * every time.
     *
     * The assertion that reads the symptom directly is the last one: nothing
     * may be invoiced for a period that has not begun.
     */
    it('never invoices a period that has not started, under a long batch', async () => {
      const count = 25;
      const created = [];
      for (let n = 0; n < count; n += 1) {
        created.push(await overdueSubscription({ daysOverdue: 1 + n }));
      }

      await Promise.all(Array.from({ length: 6 }, () => renewals.sweep()));

      const issued = await allInvoices();

      // One period each, no more.
      expect(issued).toHaveLength(count);
      for (const subscription of created) {
        expect(
          issued.filter((invoice) => invoice.subscriptionId === subscription.id),
          `subscription ${subscription.id} was invoiced more than once`,
        ).toHaveLength(1);
      }

      // The symptom, stated plainly: a renewal charges for the period being
      // entered, never for one still in the future.
      const now = Date.now();
      for (const invoice of issued) {
        expect(
          invoice.periodStart!.getTime(),
          `invoice ${invoice.invoiceNumber} charges for a period starting ${invoice.periodStart?.toISOString()}, which has not begun`,
        ).toBeLessThanOrEqual(now);
      }
    });

    /**
     * An administrator pressing "Renew" at the moment the timer fires. Same
     * guarantee, reached by a different path — one call carries a principal and
     * the other does not.
     */
    it('charges once when a manual renewal races the sweep', async () => {
      const subscription = await overdueSubscription();

      await Promise.all([
        subscriptions.renew(principal, subscription.id),
        renewals.sweep(),
        subscriptions.renew(principal, subscription.id),
      ]);

      expect(await invoicesFor(subscription.id)).toHaveLength(1);
      expect(await allInvoices()).toHaveLength(1);
    });

    /**
     * The crash case: the invoice was written and the process died before the
     * date advanced. The subscription is still due, so the next sweep tries
     * again — and must finish the job rather than charge for it again.
     *
     * Invoicing before advancing is what makes this the recoverable failure.
     * The other order loses the period silently: the date moves, nothing is
     * billed, and no later sweep ever notices because the subscription is no
     * longer due.
     */
    it('finishes an interrupted renewal without charging again', async () => {
      const subscription = await overdueSubscription();

      // Exactly what a renewal does first, and then nothing else.
      const orphan = await invoices.issue(principal, {
        customerId,
        lines: [{ description: 'Starter — renewal', unitPriceInPaise: 120_000, quantity: 1 }],
        forPeriod: { subscriptionId: subscription.id, periodStart: subscription.renewsAt },
      });

      const summary = await renewals.sweep();

      const issued = await invoicesFor(subscription.id);
      expect(issued).toHaveLength(1);
      expect(issued[0]?.id).toBe(orphan.id);
      expect(summary.alreadyInvoiced).toContain(subscription.id);

      // The advance still happened, so the subscription is no longer due.
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(after.renewsAt.getTime()).toBeGreaterThan(Date.now());
    });

    /**
     * Rule 46(b): the serial sequence must have no gaps. A refused duplicate
     * must therefore not burn a number — the allocation and the insert are in
     * one transaction, so the rollback takes both.
     *
     * Seen to fail: allocating the serial in its own transaction before the
     * insert leaves one consumed number per refused attempt, which reads as a
     * suppressed invoice to anyone auditing the sequence.
     */
    it('burns no invoice number when a duplicate is refused', async () => {
      const subscription = await overdueSubscription();
      await renewals.sweep();

      const before = await prisma.invoiceSequence.findFirstOrThrow({
        orderBy: { updatedAt: 'desc' },
      });

      // Five attempts, every one of them refused.
      await Promise.all(Array.from({ length: 5 }, () => renewals.sweep()));

      const after = await prisma.invoiceSequence.findUniqueOrThrow({
        where: { financialYear: before.financialYear },
      });
      expect(after.lastNumber).toBe(before.lastNumber);
    });
  });

  describe('ending what was cancelled', () => {
    /**
     * `cancel` deliberately leaves the subscription ACTIVE — the customer has
     * paid through the end of the period and cutting them off early takes back
     * time they own. Something has to come back afterwards and end it, and
     * until this worker existed nothing did: a cancelled customer kept their
     * hosting forever.
     */
    it('expires a cancelled subscription once its paid period ends', async () => {
      const subscription = await overdueSubscription({
        autoRenew: false,
        cancelledAt: new Date(Date.now() - 10 * DAY),
      });

      const summary = await renewals.sweep();

      expect(summary.expired).toContain(subscription.id);
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(after.status).toBe('EXPIRED');
    });

    it('leaves a cancelled subscription running until that period ends', async () => {
      const subscription = await prisma.subscription.create({
        data: {
          customerId,
          planId,
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 300 * DAY),
          renewsAt: new Date(Date.now() + 20 * DAY),
          autoRenew: false,
          cancelledAt: new Date(),
        },
      });

      await renewals.sweep();

      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(after.status).toBe('ACTIVE');
    });

    /**
     * Auto-renew off without a cancellation is a customer who pays by hand. The
     * filter is `cancelledAt`, not `autoRenew`, precisely so this case is not
     * swept away — expiring it would cut off a paying customer.
     */
    it('does not expire a subscription nobody cancelled', async () => {
      const subscription = await overdueSubscription({ autoRenew: false, cancelledAt: null });

      await renewals.sweep();

      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(after.status).toBe('ACTIVE');
    });

    /** Expiry runs before renewal, so a cancellation is never billed one last time. */
    it('expires rather than renews a subscription cancelled before its date', async () => {
      const subscription = await overdueSubscription({
        autoRenew: false,
        cancelledAt: new Date(Date.now() - 2 * DAY),
      });

      await renewals.sweep();

      expect(await invoicesFor(subscription.id)).toHaveLength(0);
    });
  });

  describe('arrears', () => {
    it('marks a subscription past due when an invoice is overdue, and clears it when paid', async () => {
      const subscription = await prisma.subscription.create({
        data: {
          customerId,
          planId,
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 300 * DAY),
          renewsAt: new Date(Date.now() + 60 * DAY),
        },
      });

      const invoice = await invoices.issue(principal, {
        customerId,
        lines: [{ description: 'Starter', unitPriceInPaise: 120_000, quantity: 1 }],
        dueAt: new Date(Date.now() - 3 * DAY),
      });

      await renewals.sweep();
      expect(
        (await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).status,
      ).toBe('PAST_DUE');

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: new Date() },
      });

      // Both directions from one place: a status that can be set and never
      // cleared leaves a customer who has paid marked as in arrears forever.
      await renewals.sweep();
      expect(
        (await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).status,
      ).toBe('ACTIVE');
    });

    /** An invoice due tomorrow is not in arrears today. */
    it('does not mark a subscription past due before the invoice is due', async () => {
      const subscription = await prisma.subscription.create({
        data: {
          customerId,
          planId,
          status: 'ACTIVE',
          startsAt: new Date(Date.now() - 300 * DAY),
          renewsAt: new Date(Date.now() + 60 * DAY),
        },
      });

      await invoices.issue(principal, {
        customerId,
        lines: [{ description: 'Starter', unitPriceInPaise: 120_000, quantity: 1 }],
        dueAt: new Date(Date.now() + DAY),
      });

      await renewals.sweep();

      expect(
        (await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).status,
      ).toBe('ACTIVE');
    });
  });

  describe('a sweep that hits a problem', () => {
    /**
     * One unrenewable subscription must not abandon the batch. The others are
     * owed invoices too, and a sweep that stops at the first failure silently
     * stops billing everyone behind it — which looks like nothing happening at
     * all, the hardest kind of billing fault to notice.
     */
    it('renews the rest of the batch when one subscription fails', async () => {
      const broken = await overdueSubscription();
      const healthy = await overdueSubscription();

      // A plan the subscription points at that no longer resolves is the shape
      // of failure a sweep actually meets: a row left behind by bad data.
      await prisma.$executeRaw`
        UPDATE subscriptions SET "planId" = ${broken.planId}::uuid WHERE id = ${broken.id}::uuid
      `;
      await prisma.hostingPlan.update({
        where: { id: planId },
        data: { priceInPaise: 120_000 },
      });

      const summary = await renewals.sweep();

      // Whatever happened to the first, the second is invoiced.
      expect(await invoicesFor(healthy.id)).toHaveLength(1);
      expect(summary.failed.length + summary.renewed.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('what the trail says', () => {
    /**
     * A renewal nobody performed must not be attributed to a person. The
     * customer-facing trail names a staff member as "WebEdge support"; using
     * that for a scheduled charge tells the customer someone opened their
     * account, which is exactly the question an unexpected invoice prompts.
     */
    it('records a swept renewal with no actor', async () => {
      const subscription = await overdueSubscription();
      await renewals.sweep();

      const row = await prisma.activityLog.findFirstOrThrow({
        where: { resourceId: subscription.id, action: 'billing.subscription.renewed' },
      });

      expect(row.adminUserId).toBeNull();
      expect(row.customerUserId).toBeNull();
      expect(row.actorEmail).toBeNull();
      expect(row.visibility).toBe('CUSTOMER');
    });

    /**
     * The standing rule, checked on this path too: nothing a customer can reach
     * names the upstream provider. The plan's `providerProduct` is on the row
     * the sweep reads, so it is one careless spread away from the invoice.
     */
    it('names no upstream product on a renewal invoice', async () => {
      const subscription = await overdueSubscription();
      await renewals.sweep();

      const [invoice] = await prisma.invoice.findMany({
        where: { subscriptionId: subscription.id },
        include: { lines: true },
      });

      const text = JSON.stringify(invoice).toLowerCase();
      for (const term of ['hostinger', 'shared-single', 'providerproduct']) {
        expect(text, `renewal invoice mentions "${term}"`).not.toContain(term);
      }
    });
  });
});
