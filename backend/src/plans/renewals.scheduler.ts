import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { loadConfig } from '../config/env';
import { RenewalsService, type SweepSummary } from './renewals.service';

/**
 * Runs the renewal sweep on a timer.
 *
 * **Why a timer and not a job queue.** BullMQ over Redis would add a second
 * record of who has been billed, and the moment it disagreed with the database
 * someone would be charged twice or not at all. The work here is a scan of a
 * table the database already owns, and `(subscriptionId, periodStart)` is
 * unique, so the database is both the queue and the lock. Redis would buy
 * retries and a dashboard at the price of the one property that matters.
 *
 * **Why no cron expression.** "Every N minutes, catching up on whatever was
 * missed" is the whole requirement. Nothing here has to happen at 02:00 — a
 * sweep that runs late produces exactly the same invoices for exactly the same
 * periods, because every date is computed from the subscription's anchor and
 * not from the time the sweep ran. A cron library would add a dependency to
 * express a schedule the work does not need.
 *
 * **Every instance runs it.** There is no leader election, because there is
 * nothing to elect a leader for: two instances sweeping at once produce the
 * same result as one, which is a property of the sweep rather than of the
 * scheduling. Making the interval safe to run twice was the requirement, and
 * that has to hold anyway — a retry after a timeout is indistinguishable from
 * a second instance.
 */
@Injectable()
export class RenewalsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RenewalsScheduler.name);
  private timer?: NodeJS.Timeout;
  /** Guards against a sweep starting while the previous one is still running. */
  private running = false;

  constructor(private readonly renewals: RenewalsService) {}

  onModuleInit(): void {
    const minutes = loadConfig().RENEWAL_SWEEP_MINUTES;

    if (minutes === 0) {
      // Said out loud. A deployment that silently never renews anything looks
      // healthy until the first customer notices they were never billed.
      this.logger.warn(
        'RENEWAL_SWEEP_MINUTES=0 — subscriptions will not renew or expire on their own.',
      );
      return;
    }

    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    // Without this the timer holds the event loop open and the process will not
    // exit on SIGTERM until the next tick.
    this.timer.unref();
    this.logger.log(`Renewal sweep every ${minutes} minute(s).`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One scheduled sweep.
   *
   * Never throws: an unhandled rejection inside a timer callback takes the
   * process down, and a billing sweep that kills the API because one
   * subscription is malformed is a worse outcome than a missed renewal. The
   * failure is logged and the next tick tries again — which is safe precisely
   * because the sweep is idempotent.
   */
  private async tick(): Promise<SweepSummary | undefined> {
    if (this.running) {
      this.logger.warn('Previous renewal sweep still running; skipping this tick.');
      return undefined;
    }
    this.running = true;

    try {
      const summary = await this.renewals.sweep();
      const touched =
        summary.renewed.length +
        summary.expired.length +
        summary.markedPastDue.length +
        summary.clearedPastDue.length;

      if (touched > 0 || summary.failed.length > 0) {
        this.logger.log(
          `Renewal sweep: ${summary.renewed.length} renewed, ${summary.expired.length} expired, ` +
            `${summary.markedPastDue.length} past due, ${summary.clearedPastDue.length} cleared, ` +
            `${summary.failed.length} failed.`,
        );
      }
      return summary;
    } catch (error) {
      this.logger.error(
        `Renewal sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    } finally {
      this.running = false;
    }
  }
}
