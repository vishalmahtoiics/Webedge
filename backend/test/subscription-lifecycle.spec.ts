import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BillingCycle, PrismaClient } from '@prisma/client';
import { ActivityService } from '../src/activity/activity.service';
import { InvoiceService } from '../src/billing/invoice.service';
import { PlansService } from '../src/plans/plans.service';
import { SubscriptionsService } from '../src/plans/subscriptions.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AdminPrincipal } from '../src/common/principal';

/**
 * Subscription lifecycle, against the real database.
 *
 * The properties that matter are about dates and money: a renewal must not move
 * the anniversary, a cancellation must not take back time the customer paid for,
 * and a plan change must credit only the part of the period actually unused.
 */
describe('subscription lifecycle', () => {
  const prisma = new PrismaClient() as PrismaService;
  const activity = new ActivityService(prisma);
  const invoices = new InvoiceService(prisma, activity);
  const plans = new PlansService(prisma, activity);
  const subscriptions = new SubscriptionsService(prisma, activity, invoices);

  const suffix = Date.now().toString(36);
  let customerId: string;
  let smallPlanId: string;
  let largePlanId: string;

  const principal: AdminPrincipal = {
    realm: 'ADMIN',
    userId: '00000000-0000-4000-8000-00000000000a',
    email: 'admin@webedgesolution.com',
    roleId: '00000000-0000-4000-8000-00000000000b',
    roleName: 'SUPER_ADMIN',
    permissions: new Set<string>(),
  };

  beforeAll(async () => {
    await prisma.$connect();

    const customer = await prisma.customer.create({
      data: {
        fullName: 'Lifecycle Co',
        email: `lifecycle-${suffix}@isolation.test`,
        status: 'ACTIVE',
        billingState: '27',
      },
    });
    customerId = customer.id;

    const small = await plans.create(principal, {
      name: 'Starter',
      slug: `starter-${suffix}`,
      priceInPaise: 120_000,
      billingCycle: BillingCycle.YEARLY,
      maxWebsites: 1,
      providerProduct: 'shared-single',
    });
    const large = await plans.create(principal, {
      name: 'Business',
      slug: `business-${suffix}`,
      priceInPaise: 480_000,
      billingCycle: BillingCycle.YEARLY,
      maxWebsites: 25,
      providerProduct: 'shared-agency',
    });
    smallPlanId = small.id;
    largePlanId = large.id;
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { customerId } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.hostingPlan.deleteMany({ where: { id: { in: [smallPlanId, largePlanId] } } });
    await prisma.$disconnect();
  });

  describe('the customer-facing catalogue', () => {
    /**
     * `providerProduct` names the upstream product a plan is fulfilled by.
     * Serializing it to a customer would say who the provider is, which is the
     * one thing a white-label panel must not do.
     */
    it('never includes the upstream product', async () => {
      const { items } = await plans.listPublic();
      const mine = items.filter((p) => p.slug.endsWith(suffix));

      expect(mine.length).toBeGreaterThan(0);
      expect(JSON.stringify(items)).not.toContain('shared-single');
      expect(JSON.stringify(items)).not.toContain('shared-agency');
      for (const plan of mine) {
        expect(plan).not.toHaveProperty('providerProduct');
      }
    });

    it('omits a withdrawn plan but keeps billing the customers on it', async () => {
      await plans.setActive(principal, largePlanId, false);
      const { items } = await plans.listPublic();
      expect(items.map((p) => p.id)).not.toContain(largePlanId);

      // Still readable by id, because subscriptions and invoices cite it.
      await expect(plans.get(largePlanId)).resolves.toMatchObject({ id: largePlanId });

      await plans.setActive(principal, largePlanId, true);
    });

    it('refuses to sell a withdrawn plan', async () => {
      await plans.setActive(principal, largePlanId, false);
      await expect(
        subscriptions.subscribe(principal, customerId, largePlanId),
      ).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
      await plans.setActive(principal, largePlanId, true);
    });
  });

  describe('subscribing', () => {
    it('sets the renewal one cycle out', async () => {
      const subscription = await subscriptions.subscribe(principal, customerId, smallPlanId);

      const expected = new Date(subscription.startsAt);
      expect(subscription.renewsAt.getUTCFullYear()).toBe(expected.getUTCFullYear() + 1);
      expect(subscription.status).toBe('ACTIVE');
    });

    /** Two live subscriptions means two sets of limits and two renewal dates. */
    it('cancels any existing active subscription', async () => {
      await subscriptions.subscribe(principal, customerId, smallPlanId);
      await subscriptions.subscribe(principal, customerId, largePlanId);

      const active = await prisma.subscription.count({
        where: { customerId, status: 'ACTIVE' },
      });
      expect(active).toBe(1);
    });
  });

  describe('renewing', () => {
    /**
     * The reason renewal dates come from `billing-period`. A subscription
     * anchored on the 31st, renewed with `Date.setMonth`, lands on the 1st of the
     * month after next and drifts further at every cycle.
     */
    it('keeps the anniversary when renewed', async () => {
      const subscription = await subscriptions.subscribe(principal, customerId, smallPlanId);

      // Anchor it to a month end, which is where the naive arithmetic fails.
      const anchored = await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          startsAt: new Date('2026-01-31T00:00:00Z'),
          renewsAt: new Date('2027-01-31T00:00:00Z'),
        },
      });

      const { subscription: renewed } = await subscriptions.renew(principal, anchored.id);
      expect(renewed.renewsAt.toISOString().slice(0, 10)).toBe('2028-01-31');
    });

    it('issues an invoice for the period it renews into', async () => {
      const subscription = await subscriptions.subscribe(principal, customerId, smallPlanId);
      const { invoice } = await subscriptions.renew(principal, subscription.id);

      expect(invoice.invoiceNumber).toMatch(/^WEB\//);
      expect(invoice.lines).toHaveLength(1);
      expect(invoice.lines[0]!.unitPriceInPaise).toBe(120_000);
      // 1,200.00 plus 18% intra-state GST, rounded to the rupee.
      expect(invoice.totalInPaise).toBe(141_600);
    });

    it('refuses to renew a subscription that was cancelled outright', async () => {
      const subscription = await subscriptions.subscribe(principal, customerId, smallPlanId);
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELLED' },
      });

      await expect(subscriptions.renew(principal, subscription.id)).rejects.toMatchObject({
        response: { code: 'CONFLICT' },
      });
    });
  });

  describe('cancelling', () => {
    /**
     * The customer has paid through `renewsAt`. Ending the service on the day
     * they cancel takes back time they own.
     */
    it('leaves the service running until the end of the paid period', async () => {
      const subscription = await subscriptions.subscribe(principal, customerId, smallPlanId);
      const cancelled = await subscriptions.cancel(principal, subscription.id, 'Moving away');

      expect(cancelled.autoRenew).toBe(false);
      expect(cancelled.cancelledAt).not.toBeNull();
      expect(cancelled.status).toBe('ACTIVE');
      expect(cancelled.renewsAt.getTime()).toBe(subscription.renewsAt.getTime());
    });

    it('requires a reason', async () => {
      const subscription = await subscriptions.subscribe(principal, customerId, smallPlanId);
      await expect(subscriptions.cancel(principal, subscription.id, '  ')).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
    });

    it('drops a cancelled subscription out of the renewal queue', async () => {
      const subscription = await subscriptions.subscribe(principal, customerId, smallPlanId);
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { renewsAt: new Date('2020-01-01T00:00:00Z') },
      });

      const beforeCancel = await subscriptions.dueForRenewal(new Date('2021-01-01T00:00:00Z'));
      expect(beforeCancel.map((s) => s.id)).toContain(subscription.id);

      await subscriptions.cancel(principal, subscription.id, 'Moving away');

      const afterCancel = await subscriptions.dueForRenewal(new Date('2021-01-01T00:00:00Z'));
      expect(afterCancel.map((s) => s.id)).not.toContain(subscription.id);
    });
  });

  describe('changing plan', () => {
    it('credits only the unused part of the current period', async () => {
      const subscription = await subscriptions.subscribe(principal, customerId, smallPlanId);

      // Half the year gone: roughly half the 1,200.00 should come back.
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          startsAt: new Date('2026-01-01T00:00:00Z'),
          renewsAt: new Date(Date.now() + 182 * 86_400_000),
        },
      });

      const { unusedCreditInPaise, invoice } = await subscriptions.changePlan(
        principal,
        subscription.id,
        largePlanId,
      );

      expect(unusedCreditInPaise).toBeGreaterThan(55_000);
      expect(unusedCreditInPaise).toBeLessThan(65_000);

      // Two lines: the new plan, and the credit for what was not used.
      expect(invoice.lines).toHaveLength(2);
      expect(invoice.lines.some((l) => l.unitPriceInPaise === 480_000)).toBe(true);
      expect(invoice.lines.some((l) => l.unitPriceInPaise === -unusedCreditInPaise)).toBe(true);
    });

    /**
     * The current period runs one cycle back from the next renewal, not from
     * `startsAt`. Prorating from the start of a subscription that has renewed
     * several times would credit years the customer already used.
     */
    it('prorates the current period, not the whole subscription', async () => {
      const subscription = await subscriptions.subscribe(principal, customerId, smallPlanId);

      // Started three years ago, renewed twice, most of this year still to run.
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          startsAt: new Date('2023-06-01T00:00:00Z'),
          renewsAt: new Date(Date.now() + 300 * 86_400_000),
        },
      });

      const { unusedCreditInPaise } = await subscriptions.changePlan(
        principal,
        subscription.id,
        largePlanId,
      );

      // Never more than one period's price, whatever the subscription's age.
      expect(unusedCreditInPaise).toBeLessThanOrEqual(120_000);
      expect(unusedCreditInPaise).toBeGreaterThan(90_000);
    });

    it('refuses a change to the plan it is already on', async () => {
      const subscription = await subscriptions.subscribe(principal, customerId, smallPlanId);
      await expect(
        subscriptions.changePlan(principal, subscription.id, smallPlanId),
      ).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
    });
  });
});
