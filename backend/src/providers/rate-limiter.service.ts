import { Injectable, Logger } from '@nestjs/common';

/**
 * Token bucket per provider account and endpoint family.
 *
 * Two things make a single global bucket wrong here. Hostinger documents
 * different limits on different endpoints — domain availability and suggestion
 * endpoints are documented at 90/minute, while some others are as low as 10 or 5
 * — so one bucket sized for the highest limit would blow the lowest, and one
 * sized for the lowest would waste the rest. And a shared bucket lets background
 * sync spend the entire budget before a customer's own click gets a turn.
 *
 * Buckets are therefore keyed by (account, family), and customer-initiated work
 * takes priority over background sync when both are waiting.
 *
 * Limits are deliberately set below what the provider documents, leaving room
 * for admin actions and for the provider counting slightly differently than we
 * do. Repeated 429s can get the calling IP temporarily blocked, so the cost of
 * being too aggressive is much higher than the cost of being slightly slow.
 *
 * NOTE: state is in-process. That is correct for a single API instance and wrong
 * the moment a second one runs, because each would keep its own budget while the
 * provider counts them together. Move to a Redis token bucket before scaling out.
 */

export type EndpointFamily =
  | 'default'
  | 'domains-availability'
  | 'hosting'
  | 'agency-hosting'
  | 'dns'
  | 'mail'
  | 'billing';

/** Requests per minute. Below the documented ceilings, on purpose. */
const LIMITS: Record<EndpointFamily, number> = {
  default: 60,
  // Documented at 90/min; 70 leaves headroom for admin actions.
  'domains-availability': 70,
  hosting: 60,
  'agency-hosting': 60,
  dns: 60,
  mail: 60,
  billing: 30,
};

const WINDOW_MS = 60_000;

type Bucket = { tokens: number; lastRefill: number };

@Injectable()
export class ProviderRateLimiter {
  private readonly logger = new Logger(ProviderRateLimiter.name);
  private readonly buckets = new Map<string, Bucket>();

  private static key(accountId: string, family: EndpointFamily): string {
    return `${accountId}:${family}`;
  }

  /**
   * Narrows a bucket after the provider says we are going too fast.
   *
   * A 429 means our model of the limit is wrong, so the observed reality wins
   * over the configured guess until the window resets.
   */
  penalize(accountId: string, family: EndpointFamily, retryAfterSeconds?: number): void {
    const bucket = this.bucketFor(accountId, family);
    bucket.tokens = 0;
    if (retryAfterSeconds && retryAfterSeconds > 0) {
      // Push the refill out to when the provider says it will accept us again.
      bucket.lastRefill = Date.now() + retryAfterSeconds * 1000 - WINDOW_MS;
    }
    this.logger.warn(
      `Rate limited by provider on account ${accountId} (${family}); pausing ${retryAfterSeconds ?? 60}s`,
    );
  }

  /** Tokens left right now, for the admin health view. */
  remaining(accountId: string, family: EndpointFamily = 'default'): number {
    const bucket = this.bucketFor(accountId, family);
    this.refill(bucket, LIMITS[family]);
    return Math.floor(bucket.tokens);
  }

  limitFor(family: EndpointFamily): number {
    return LIMITS[family];
  }

  /**
   * Waits for a token, then consumes it.
   *
   * Background work yields to customer-initiated work by waiting a full extra
   * window when the bucket is empty, rather than racing for the next token.
   */
  async acquire(
    accountId: string,
    family: EndpointFamily = 'default',
    priority: 'customer' | 'background' = 'customer',
  ): Promise<void> {
    const limit = LIMITS[family];
    const bucket = this.bucketFor(accountId, family);

    for (let attempt = 0; attempt < 120; attempt += 1) {
      this.refill(bucket, limit);

      // Background work leaves a reserve so a customer click never queues behind
      // a sync sweep that is using the whole budget.
      const floor = priority === 'background' ? limit * 0.25 : 0;

      if (bucket.tokens > floor) {
        bucket.tokens -= 1;
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, priority === 'background' ? 2000 : 500));
    }

    throw new Error(
      `Timed out waiting for rate-limit capacity on account ${accountId} (${family})`,
    );
  }

  /** Test seam: drop all buckets. */
  reset(): void {
    this.buckets.clear();
  }

  private bucketFor(accountId: string, family: EndpointFamily): Bucket {
    const key = ProviderRateLimiter.key(accountId, family);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: LIMITS[family], lastRefill: Date.now() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /** Continuous refill rather than a hard window reset, which would let a burst
   * of `limit` requests land at the boundary and then another immediately after. */
  private refill(bucket: Bucket, limit: number): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    if (elapsed <= 0) return;

    bucket.tokens = Math.min(limit, bucket.tokens + (elapsed / WINDOW_MS) * limit);
    bucket.lastRefill = now;
  }
}
