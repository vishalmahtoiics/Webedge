import { Injectable, Logger } from '@nestjs/common';
import { DiscoveredKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { ProviderAccountsService } from './provider-accounts.service';
import { ProviderRateLimiter } from './rate-limiter.service';
import { probe } from './hostinger.client';
import { keysOf, listOf, mapResource } from './resource-mapping';
import { notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * Pulls what exists on the provider account into WebEdge's own database.
 *
 * The point is that pages stop asking the provider. A page load reads local
 * state — never a live provider call — so the inventory has to be here before
 * anything can show it, and a sync is the only thing that fetches.
 *
 * **Read-only.** Every call is a GET. Nothing on the provider is created,
 * changed or deleted, which is what makes it safe to run against a live account
 * under the rule that nothing outside production is written to unless its name
 * starts with `wetest-`.
 *
 * **Nothing discovered belongs to a customer.** Rows land in
 * `DiscoveredResource`, which is infrastructure, not in `Domain` or `Website`,
 * which are customer-owned and carry a non-null tenant. Attaching one to a
 * customer is a separate, deliberate act by a staff member — and it has to be,
 * because attaching the wrong domain to the wrong customer is a tenancy breach
 * that nothing downstream can undo.
 */

const SOURCES: Array<{ kind: DiscoveredKind; area: string; path: string }> = [
  { kind: DiscoveredKind.DOMAIN, area: 'domains', path: '/api/domains/v1/portfolio' },
  { kind: DiscoveredKind.WEBSITE, area: 'websites', path: '/api/hosting/v1/websites' },
  { kind: DiscoveredKind.WEBSITE, area: 'agency websites', path: '/api/agency-hosting/v1/websites' },
  { kind: DiscoveredKind.VPS, area: 'vps', path: '/api/vps/v1/virtual-machines' },
  { kind: DiscoveredKind.SUBSCRIPTION, area: 'billing', path: '/api/billing/v1/subscriptions' },
];

export type SyncedSource = {
  area: string;
  kind: DiscoveredKind;
  ok: boolean;
  status: number | null;
  /** Records the provider returned. Null when the response was unreadable. */
  received: number | null;
  stored: number;
  /** Records with no stable key, which cannot be tracked across syncs. */
  skipped: number;
  /** Stored rows whose name could not be resolved. */
  unnamed: number;
  /** The payload's own keys, present when nothing mapped — so it can be fixed. */
  payloadKeys?: string[];
  detail?: string;
};

export type SyncReport = {
  accountId: string;
  syncedAt: Date;
  sources: SyncedSource[];
  totalStored: number;
};

@Injectable()
export class ProviderSyncService {
  private readonly logger = new Logger(ProviderSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly accounts: ProviderAccountsService,
    private readonly rateLimiter: ProviderRateLimiter,
  ) {}

  async sync(principal: Principal, accountId: string): Promise<SyncReport> {
    const account = await this.prisma.hostingAccount.findUnique({
      where: { id: accountId },
      select: { id: true, accountName: true },
    });
    if (!account) throw notFound('provider account');

    const token = await this.accounts.activeToken(accountId);
    const syncedAt = new Date();
    const sources: SyncedSource[] = [];

    for (const source of SOURCES) {
      await this.rateLimiter.acquire(accountId);
      sources.push(await this.syncSource(accountId, token, source, syncedAt));
    }

    const totalStored = sources.reduce((sum, source) => sum + source.stored, 0);
    const anyRead = sources.some((source) => source.ok);

    await this.prisma.hostingAccount.update({
      where: { id: accountId },
      data: {
        lastSyncedAt: syncedAt,
        lastErrorAt: anyRead ? null : syncedAt,
        lastError: anyRead ? null : (sources.find((s) => !s.ok)?.detail ?? 'Nothing could be read.'),
        // Capacity from the provider's own count, not from anything typed in.
        websiteSlotsUsed: sources
          .filter((source) => source.kind === DiscoveredKind.WEBSITE && source.ok)
          .reduce((sum, source) => sum + source.stored, 0),
      },
    });

    await this.activity.record(principal, {
      action: 'admin.provider_account.synced',
      resourceType: 'hosting_account',
      resourceId: accountId,
      newValue: {
        totalStored,
        sources: sources.map((s) => ({ area: s.area, ok: s.ok, stored: s.stored })),
      },
    });

    return { accountId, syncedAt, sources, totalStored };
  }

  private async syncSource(
    accountId: string,
    token: string,
    source: { kind: DiscoveredKind; area: string; path: string },
    syncedAt: Date,
  ): Promise<SyncedSource> {
    const outcome = await probe(token, source.area, source.path);

    if (!outcome.ok) {
      // A product the account does not have answers 404, which is not a fault
      // and not an empty inventory either. It is recorded as what it was.
      return {
        area: source.area,
        kind: source.kind,
        ok: false,
        status: outcome.status,
        received: null,
        stored: 0,
        skipped: 0,
        unnamed: 0,
        detail: outcome.detail,
      };
    }

    // Re-fetched rather than threaded through `probe`, which deliberately
    // returns a count and not a body — its job is answering "does this work",
    // and widening it to carry payloads would put provider data on a path that
    // exists to be safe to log.
    const rows = await this.fetchRows(token, source.path);
    if (rows === null) {
      return {
        area: source.area,
        kind: source.kind,
        ok: true,
        status: outcome.status,
        received: null,
        stored: 0,
        skipped: 0,
        unnamed: 0,
        detail: 'The provider answered, but nothing list-shaped was found in the response.',
      };
    }

    let stored = 0;
    let skipped = 0;
    let unnamed = 0;

    for (const row of rows) {
      const mapped = mapResource(row);
      if (!mapped) {
        // No stable key, so it cannot be matched on a later sync. Storing it
        // would duplicate the row on every run.
        skipped += 1;
        continue;
      }
      if (mapped.name === null) unnamed += 1;

      await this.prisma.discoveredResource.upsert({
        where: {
          hostingAccountId_kind_providerKey: {
            hostingAccountId: accountId,
            kind: source.kind,
            providerKey: mapped.providerKey,
          },
        },
        create: {
          hostingAccountId: accountId,
          kind: source.kind,
          providerKey: mapped.providerKey,
          name: mapped.name,
          status: mapped.status,
          expiresAt: mapped.expiresAt,
          raw: mapped.raw as Prisma.InputJsonValue,
          mapped: mapped.mapped,
          lastSeenAt: syncedAt,
        },
        update: {
          name: mapped.name,
          status: mapped.status,
          expiresAt: mapped.expiresAt,
          raw: mapped.raw as Prisma.InputJsonValue,
          mapped: mapped.mapped,
          lastSeenAt: syncedAt,
          // firstSeenAt is deliberately untouched: it is when this resource
          // first appeared on the account, which a re-sync does not change.
        },
      });
      stored += 1;
    }

    return {
      area: source.area,
      kind: source.kind,
      ok: true,
      status: outcome.status,
      received: rows.length,
      stored,
      skipped,
      unnamed,
      // Shown only when the mapping struggled, and then it is the fix: the
      // provider's own key names, so the candidate list can be corrected
      // instead of guessed at a second time.
      payloadKeys: unnamed > 0 || skipped > 0 ? keysOf(rows) : undefined,
    };
  }

  /** The raw list. Separate from `probe` so the safe path stays payload-free. */
  private async fetchRows(token: string, path: string): Promise<unknown[] | null> {
    try {
      const response = await fetch(`https://developers.hostinger.com${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'WebEdge/1.0',
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return null;
      return listOf(await response.json());
    } catch (error) {
      // Never the raw message: a fetch rejection can quote the request, and the
      // request carries the Authorization header.
      this.logger.error(
        `Sync fetch failed for ${path}: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return null;
    }
  }
}
