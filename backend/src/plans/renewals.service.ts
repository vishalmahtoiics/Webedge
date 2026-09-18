import { Injectable, Logger } from '@nestjs/common';
import { InvoiceStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * The sweep that makes subscriptions actually happen.
 *
 * Until this existed, `renewsAt` was a date nothing read. A subscription passed
 * it and sat there: no invoice was raised, the service kept working, and the
 * customer was never billed. A cancellation was worse — `cancel` switches
 * auto-renew off and leaves the status ACTIVE deliberately, because the
 * customer has paid through the end of the period, but nothing ever came back
 * to end it. Cancelled customers kept their service indefinitely.
 *
 * Three things happen here, in this order, and the order matters:
 *
 *  1. **Expire** what has been cancelled and has now run out. Before renewing,
 *     so a subscription cancelled yesterday and due today is ended rather than
 *     billed for another period.
 *  2. **Renew** what is due and still has auto-renew on.
 *  3. **Re-assess arrears** — which subscriptions have an overdue invoice.
 *     After renewing, so an invoice raised in this same sweep is judged on its
 *     own due date rather than on the state before it existed.
 *
 * **Correctness does not depend on this running once.** Every step is a
 * compare-and-swap or is covered by the unique index on
 * `(subscriptionId, periodStart)`, so two instances sweeping simultaneously,
 * a retry after a timeout, or an administrator pressing "Renew" mid-sweep all
 * converge on the same result. That is the reason there is no Redis queue
 * here: the database already holds the only record of who has been billed, and
 * a second store that could disagree with it is a way to bill someone twice.
 *
 * **It stops where money moves.** A renewal raises an invoice and marks it due.
 * Collecting it is the payment gateway's job, and there is no gateway yet, so
 * nothing here marks anything paid or pretends a payment happened.
 */

export type SweepSummary = {
  startedAt: Date;
  finishedAt: Date;
  expired: string[];
  renewed: Array<{ subscriptionId: string; invoiceNumber: string | null }>;
  /** Already invoiced by someone else; the sweep only finished the advance. */
  alreadyInvoiced: string[];
  /** Renewed by another sweep between being listed and being reached. */
  skipped: string[];
  markedPastDue: string[];
  clearedPastDue: string[];
  failed: Array<{ subscriptionId: string; reason: string }>;
};

/** How many subscriptions one sweep will take on. */
const BATCH = 100;

@Injectable()
export class RenewalsService {
  private readonly logger = new Logger(RenewalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async sweep(now = new Date()): Promise<SweepSummary> {
    const summary: SweepSummary = {
      startedAt: now,
      finishedAt: now,
      expired: [],
      renewed: [],
      alreadyInvoiced: [],
      skipped: [],
      markedPastDue: [],
      clearedPastDue: [],
      failed: [],
    };

    await this.expire(now, summary);
    await this.renewDue(now, summary);
    await this.reassessArrears(now, summary);

    summary.finishedAt = new Date();
    return summary;
  }

  /**
   * Ends subscriptions that were cancelled and have now run out of paid time.
   *
   * The filter is `cancelledAt` rather than `autoRenew` alone: auto-renew can be
   * switched off on a subscription nobody cancelled — a customer who intends to
   * pay by hand — and expiring that would cut off a paying customer.
   */
  private async expire(now: Date, summary: SweepSummary): Promise<void> {
    const due = await this.prisma.subscription.findMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        cancelledAt: { not: null },
        autoRenew: false,
        renewsAt: { lte: now },
      },
      select: { id: true, customerId: true, renewsAt: true },
      take: BATCH,
    });

    for (const subscription of due) {
      // Compare-and-swap on the date: if another sweep expired it, or a renewal
      // moved it, this matches nothing and no second log row is written.
      const changed = await this.prisma.subscription.updateMany({
        where: {
          id: subscription.id,
          renewsAt: subscription.renewsAt,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        },
        data: { status: SubscriptionStatus.EXPIRED },
      });
      if (changed.count === 0) continue;

      summary.expired.push(subscription.id);
      await this.activity.record(undefined, {
        action: 'billing.subscription.expired',
        customerId: subscription.customerId,
        resourceType: 'subscription',
        resourceId: subscription.id,
        visibility: 'CUSTOMER',
        newValue: { endedAt: subscription.renewsAt },
      });
    }
  }

  /** Renews everything due, one at a time, and never gives up the batch. */
  private async renewDue(now: Date, summary: SweepSummary): Promise<void> {
    const due = await this.subscriptions.dueForRenewal(now, BATCH);

    for (const subscription of due) {
      try {
        // Pinned to the period this sweep selected. Without it, a sweep that
        // lost the race renews the *next* period instead of doing nothing —
        // a second invoice, dated a cycle ahead, that no unique index catches
        // because its key is genuinely different.
        const result = await this.subscriptions.renew(
          undefined,
          subscription.id,
          subscription.renewsAt,
        );
        if (result.skipped) {
          summary.skipped.push(subscription.id);
          continue;
        }
        if (result.alreadyInvoiced) summary.alreadyInvoiced.push(subscription.id);
        if (result.advanced || result.alreadyInvoiced) {
          summary.renewed.push({
            subscriptionId: subscription.id,
            invoiceNumber: result.invoice.invoiceNumber,
          });
        }
      } catch (error) {
        // One subscription that cannot be renewed must not stop the rest: the
        // others are owed invoices too, and a sweep that abandons the batch on
        // the first failure silently stops billing everybody behind it.
        const reason = error instanceof Error ? error.message : String(error);
        summary.failed.push({ subscriptionId: subscription.id, reason });
        this.logger.error(`Renewal failed for subscription ${subscription.id}: ${reason}`);
      }
    }
  }

  /**
   * Brings each subscription's status in line with whether it owes money.
   *
   * Both directions, in one place. A status that can be set but never cleared
   * leaves a customer who has paid marked as in arrears forever, and support
   * fixes it by editing the database.
   *
   * PAST_DUE is a statement about unpaid invoices, so renewal does not touch it
   * — raising another invoice does not settle the ones already outstanding.
   * This method is the only thing that sets or clears it.
   */
  private async reassessArrears(now: Date, summary: SweepSummary): Promise<void> {
    const overdue = await this.prisma.invoice.groupBy({
      by: ['customerId'],
      where: {
        status: InvoiceStatus.ISSUED,
        dueAt: { lt: now },
      },
      _count: { _all: true },
    });
    const inArrears = new Set(overdue.map((row) => row.customerId));

    const subscriptions = await this.prisma.subscription.findMany({
      where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] } },
      select: { id: true, customerId: true, status: true },
      take: BATCH,
    });

    for (const subscription of subscriptions) {
      const owes = inArrears.has(subscription.customerId);
      const target = owes ? SubscriptionStatus.PAST_DUE : SubscriptionStatus.ACTIVE;
      if (subscription.status === target) continue;

      const changed = await this.prisma.subscription.updateMany({
        where: { id: subscription.id, status: subscription.status },
        data: { status: target },
      });
      if (changed.count === 0) continue;

      (owes ? summary.markedPastDue : summary.clearedPastDue).push(subscription.id);
      await this.activity.record(undefined, {
        action: owes ? 'billing.subscription.past_due' : 'billing.subscription.in_good_standing',
        customerId: subscription.customerId,
        resourceType: 'subscription',
        resourceId: subscription.id,
        visibility: 'CUSTOMER',
        oldValue: { status: subscription.status },
        newValue: { status: target },
      });
    }
  }
}
