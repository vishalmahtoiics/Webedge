import { Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { InvoiceService, isDuplicatePeriod } from '../billing/invoice.service';
import { MONTHS_IN_CYCLE, addMonths, nextRenewal, renewalAfter } from '../billing/billing-period';
import { prorate } from '../billing/gst';
import { AppError, notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * Subscription lifecycle.
 *
 * Every date here goes through `billing-period`, never `Date.setMonth`, which
 * overflows at month ends and walks a renewal date forward a day or three every
 * cycle.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly invoices: InvoiceService,
  ) {}

  /**
   * Puts a customer on a plan.
   *
   * Any existing active subscription is cancelled in the same transaction: a
   * customer on two plans at once has two sets of limits and two renewal dates,
   * and nothing downstream says which one applies.
   */
  async subscribe(principal: Principal, customerId: string, planId: string) {
    const [customer, plan] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }),
      this.prisma.hostingPlan.findUnique({ where: { id: planId } }),
    ]);
    if (!customer) throw notFound('customer');
    if (!plan) throw notFound('plan');

    if (!plan.isActive) {
      throw new AppError('CONFLICT', 'That plan has been withdrawn and cannot be sold.');
    }

    const startsAt = new Date();
    const renewsAt = nextRenewal(startsAt, plan.billingCycle);

    const subscription = await this.prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { customerId, status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.CANCELLED, cancelledAt: startsAt },
      });

      return tx.subscription.create({
        data: { customerId, planId, status: SubscriptionStatus.ACTIVE, startsAt, renewsAt },
      });
    });

    await this.activity.record(principal, {
      action: 'admin.customer.plan_assigned',
      customerId,
      resourceType: 'subscription',
      resourceId: subscription.id,
      visibility: 'CUSTOMER',
      newValue: { plan: plan.name, renewsAt },
    });

    return subscription;
  }

  /**
   * Renews a subscription: advances the period and invoices for it.
   *
   * The new date is computed from the subscription's start, not from the date it
   * happens to be renewed on. Renewing late must not move the anniversary — a
   * subscription processed three days after its renewal date is still due on the
   * same day of the month next time.
   *
   * **Invoicing happens before the date advances, and both steps are keyed to
   * the period.** The order is deliberate and is what makes an interrupted
   * renewal safe:
   *
   *  - Advance first and die, and the period is gone with nothing billed for
   *    it. Nobody notices, because the next sweep sees a subscription that is
   *    not due.
   *  - Invoice first and die, and the next sweep finds the subscription still
   *    due, tries to invoice, is refused by the unique index, recovers the
   *    invoice that already exists and finishes the advance. Self-healing, and
   *    at no point is a customer charged twice.
   *
   * The advance is a compare-and-swap on the date that was invoiced against, so
   * a renewal that lost the race cannot advance the period a second time.
   *
   * `principal` is optional because the renewal worker has no session. The trail
   * then records a renewal with no actor, which is the truth: nobody did it.
   *
   * **`expectedPeriodStart` pins which period the caller means.** A caller that
   * selected this subscription earlier — the sweep lists what is due and then
   * renews each row — is working from a value that may already be stale. Without
   * the pin, re-reading the row picks up whatever it says *now*: if another
   * sweep advanced it a millisecond ago, this one invoices for the period that
   * has not started yet, under a different key that the unique index has no
   * reason to reject. That is a second charge, dated a full cycle into the
   * future, and it was reproducible — two invoices from ten concurrent sweeps,
   * flaky in proportion to how long the batch took.
   *
   * A caller that passes no pin is asking to renew whatever period is next,
   * which is what an administrator pressing the button means. That path reads
   * the row itself, so it has no stale value to be wrong about.
   */
  async renew(
    principal: Principal | undefined,
    subscriptionId: string,
    expectedPeriodStart?: Date,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) throw notFound('subscription');

    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new AppError('CONFLICT', 'That subscription was cancelled and cannot be renewed.');
    }
    if (subscription.status === SubscriptionStatus.EXPIRED) {
      throw new AppError('CONFLICT', 'That subscription has expired and cannot be renewed.');
    }

    // The period being charged for. Named by the date it starts, which is the
    // renewal date as it stands right now — before anything advances it.
    const periodStart = subscription.renewsAt;

    if (expectedPeriodStart && periodStart.getTime() !== expectedPeriodStart.getTime()) {
      // Someone renewed this period between the caller selecting it and now.
      // Renewing the *next* period instead would charge for time the customer
      // has not reached, so this does nothing and says so.
      return {
        subscription,
        invoice: undefined,
        alreadyInvoiced: false,
        advanced: false,
        skipped: true as const,
      };
    }
    const renewsAt = renewalAfter(
      subscription.startsAt,
      subscription.renewsAt,
      subscription.plan.billingCycle,
    );

    let alreadyInvoiced = false;
    let invoice;
    try {
      invoice = await this.invoices.issue(principal, {
        customerId: subscription.customerId,
        lines: [
          {
            description: `${subscription.plan.name} — renewal to ${renewsAt.toISOString().slice(0, 10)}`,
            unitPriceInPaise: subscription.plan.priceInPaise,
            quantity: 1,
          },
        ],
        dueAt: subscription.renewsAt,
        forPeriod: { subscriptionId, periodStart },
      });
    } catch (error) {
      if (!isDuplicatePeriod(error)) throw error;

      // Another renewal got there first. Its invoice is the one that counts.
      alreadyInvoiced = true;
      const existing = await this.invoices.forPeriod(subscriptionId, periodStart);
      if (!existing) {
        throw new AppError(
          'OPERATION_FAILED',
          'That period was already invoiced, but the invoice could not be read back.',
        );
      }
      invoice = existing;
    }

    // Only if the date is still the one just invoiced against. A concurrent
    // renewal that already advanced it must not advance it again — that would
    // skip a period nobody was charged for.
    const advanced = await this.prisma.subscription.updateMany({
      where: { id: subscriptionId, renewsAt: periodStart },
      data: { renewsAt },
    });

    if (advanced.count > 0) {
      await this.activity.record(principal, {
        action: 'billing.subscription.renewed',
        customerId: subscription.customerId,
        resourceType: 'subscription',
        resourceId: subscriptionId,
        visibility: 'CUSTOMER',
        oldValue: { renewsAt: periodStart },
        newValue: { renewsAt, invoiceNumber: invoice.invoiceNumber },
      });
    }

    const renewed = await this.prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });

    return {
      subscription: renewed,
      invoice,
      alreadyInvoiced,
      advanced: advanced.count > 0,
      skipped: false as const,
    };
  }

  /**
   * Cancels a subscription at the end of the period already paid for.
   *
   * Not immediately: the customer has paid through `renewsAt`, and cutting the
   * service off on the day they cancel takes back time they own. Auto-renew is
   * switched off and the status stays ACTIVE until the period ends, which is
   * also what makes "cancelled but still working" explainable to support.
   */
  async cancel(principal: Principal, subscriptionId: string, reason: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: { select: { name: true } } },
    });
    if (!subscription) throw notFound('subscription');

    if (!reason.trim()) {
      throw new AppError('INVALID_REQUEST', 'A reason is required to cancel a subscription.');
    }
    if (subscription.cancelledAt) return subscription;

    const cancelled = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { autoRenew: false, cancelledAt: new Date() },
    });

    await this.activity.record(principal, {
      action: 'billing.subscription.cancelled',
      customerId: subscription.customerId,
      resourceType: 'subscription',
      resourceId: subscriptionId,
      visibility: 'CUSTOMER',
      newValue: {
        plan: subscription.plan.name,
        // The date the service actually ends, which is the question a customer
        // asks the moment they cancel.
        activeUntil: subscription.renewsAt,
        reason,
      },
    });

    return cancelled;
  }

  /**
   * Moves a subscription to another plan, crediting the unused part of the
   * current period.
   *
   * The credit is computed by whole days, from `gst.ts`. An amount a customer can
   * check by hand beats one that is a few paise more accurate and impossible to
   * verify.
   */
  async changePlan(principal: Principal, subscriptionId: string, newPlanId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) throw notFound('subscription');

    const newPlan = await this.prisma.hostingPlan.findUnique({ where: { id: newPlanId } });
    if (!newPlan) throw notFound('plan');
    if (!newPlan.isActive) {
      throw new AppError('CONFLICT', 'That plan has been withdrawn and cannot be sold.');
    }
    if (newPlan.id === subscription.planId) {
      throw new AppError('CONFLICT', 'The subscription is already on that plan.');
    }

    const changeDate = new Date();

    // The period being left is the *current* one, which runs one cycle back from
    // the next renewal — not from `startsAt`. After even one renewal those are
    // different dates, and prorating across the whole lifetime of a subscription
    // would credit a customer for years they already used.
    const periodStart = addMonths(
      subscription.renewsAt,
      -MONTHS_IN_CYCLE[subscription.plan.billingCycle],
    );

    const { unusedCreditInPaise, remainingDays } = prorate({
      amountInPaise: subscription.plan.priceInPaise,
      periodStart,
      periodEnd: subscription.renewsAt,
      changeDate,
    });

    const lines = [
      {
        description: `${newPlan.name} — from ${changeDate.toISOString().slice(0, 10)}`,
        unitPriceInPaise: newPlan.priceInPaise,
        quantity: 1,
      },
    ];
    if (unusedCreditInPaise > 0) {
      lines.push({
        description: `Unused ${subscription.plan.name} (${remainingDays} days)`,
        unitPriceInPaise: -unusedCreditInPaise,
        quantity: 1,
      });
    }

    const invoice = await this.invoices.issue(principal, {
      customerId: subscription.customerId,
      lines,
    });

    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        planId: newPlan.id,
        startsAt: changeDate,
        renewsAt: nextRenewal(changeDate, newPlan.billingCycle),
        status: SubscriptionStatus.ACTIVE,
      },
    });

    await this.activity.record(principal, {
      action: 'billing.subscription.plan_changed',
      customerId: subscription.customerId,
      resourceType: 'subscription',
      resourceId: subscriptionId,
      visibility: 'CUSTOMER',
      oldValue: { plan: subscription.plan.name },
      newValue: {
        plan: newPlan.name,
        creditInPaise: unusedCreditInPaise,
        invoiceNumber: invoice.invoiceNumber,
      },
    });

    return { subscription: updated, invoice, unusedCreditInPaise };
  }

  /** Subscriptions due to renew on or before a date, for the renewal worker. */
  async dueForRenewal(before: Date, take = 50) {
    return this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        autoRenew: true,
        renewsAt: { lte: before },
      },
      orderBy: { renewsAt: 'asc' },
      take: Math.min(Math.max(take, 1), 100),
      include: {
        plan: { select: { name: true, priceInPaise: true } },
        // For the operator reading the list. A customer id answers no question
        // anyone actually has about an upcoming charge.
        customer: { select: { fullName: true, companyName: true } },
      },
    });
  }
}
