import { Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

/**
 * Plan limits, enforced at the point of creation.
 *
 * `HostingPlan` has carried `maxWebsites`, `maxMailboxes` and the rest since the
 * schema was written, and `PLAN_LIMIT_REACHED` has been in the error catalogue
 * just as long, with nothing throwing it — there was no creation path to guard.
 * Mailboxes are the first, so this is where enforcement starts.
 *
 * Two rules shape it:
 *
 *  - **Null is unlimited, and only null.** A plan with no stated limit does not
 *    fall back to a default number. "Unlimited" and "one hundred" are different
 *    promises, and a default would silently make the first into the second.
 *  - **No plan is not unlimited.** A customer with no active subscription cannot
 *    create resources at all. Treating an absent plan as unbounded is how a
 *    cancelled account keeps consuming.
 */

/** The countable limits a plan declares. */
export type LimitKey = 'maxWebsites' | 'maxDomains' | 'maxDatabases' | 'maxMailboxes';

const NOUN: Record<LimitKey, { singular: string; plural: string }> = {
  maxWebsites: { singular: 'website', plural: 'websites' },
  maxDomains: { singular: 'domain', plural: 'domains' },
  maxDatabases: { singular: 'database', plural: 'databases' },
  maxMailboxes: { singular: 'mailbox', plural: 'mailboxes' },
};

export type LimitState = {
  limit: number | null;
  used: number;
  /** Null when the limit is unlimited — there is no remainder to report. */
  remaining: number | null;
};

@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The plan a customer's limits come from.
   *
   * A cancelled subscription still counts while it runs: cancelling ends service
   * at the end of the paid period, so a customer mid-notice keeps the plan they
   * paid for. `status` stays ACTIVE until then, which is what makes that work
   * without a second rule here.
   */
  private async activePlan(customerId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { customerId, status: SubscriptionStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

    return subscription?.plan ?? null;
  }

  async state(customerId: string, key: LimitKey): Promise<LimitState> {
    const plan = await this.activePlan(customerId);
    const used = await this.count(customerId, key);

    // No plan means no allowance. Reported as a limit of zero rather than as
    // unlimited, because an absent plan is a reason to refuse, not to permit.
    if (!plan) return { limit: 0, used, remaining: 0 };

    const limit = plan[key];
    return { limit, used, remaining: limit === null ? null : Math.max(limit - used, 0) };
  }

  /**
   * Refuses when creating one more would exceed the plan.
   *
   * Called before the write. The count and the write are not in one transaction,
   * so two simultaneous requests can both pass a limit of one — a race worth
   * naming rather than hiding. It is bounded (a customer can exceed a limit by
   * the number of requests they make at once, not indefinitely), it is visible
   * on the next check, and the fix is a unique constraint or a locked row per
   * customer, which is worth doing when there is a creation path that matters
   * more than a mailbox.
   */
  async assertCanCreate(customerId: string, key: LimitKey, adding = 1): Promise<LimitState> {
    const state = await this.state(customerId, key);
    if (state.limit === null) return state;

    if (state.used + adding > state.limit) {
      const noun = state.limit === 1 ? NOUN[key].singular : NOUN[key].plural;
      throw new AppError(
        'PLAN_LIMIT_REACHED',
        state.limit === 0
          ? `Your plan does not include ${NOUN[key].plural}.`
          : `Your plan includes ${state.limit} ${noun}, and ${state.used} are in use.`,
        // The numbers go in details so the UI can offer the upgrade without
        // parsing the sentence.
        { limit: state.limit, used: state.used, resource: key },
      );
    }

    return state;
  }

  /** What is in use now. Counted, never cached: a stale count is an over-sell. */
  private async count(customerId: string, key: LimitKey): Promise<number> {
    switch (key) {
      case 'maxWebsites':
        return this.prisma.website.count({ where: { customerId } });
      case 'maxDomains':
        return this.prisma.domain.count({ where: { customerId } });
      case 'maxDatabases':
        // No database model yet — Phase 4, and blocked on the provider account.
        // Returning zero would report an allowance that has not been checked, so
        // this stays explicit until there is something to count.
        return 0;
      case 'maxMailboxes':
        // Mailboxes hang off mail domains, which is where the tenant lives.
        return this.prisma.mailbox.count({ where: { domain: { customerId } } });
    }
  }
}
