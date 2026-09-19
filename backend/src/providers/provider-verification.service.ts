import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { ProviderAccountsService } from './provider-accounts.service';
import { ProviderRateLimiter } from './rate-limiter.service';
import { PROBES, probe, type ProbeOutcome } from './hostinger.client';
import { notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * Answers "does this token work, and what can it reach?"
 *
 * Until this existed the panel accepted any eight-character string as an API
 * token and said nothing more about it. The first sign that a token was wrong
 * came whenever someone tried to use it — which, with provisioning not yet
 * built, was never. A credential that has never been used is a credential
 * nobody has checked.
 *
 * Every call is a GET. That is what makes running this against a live account
 * safe: the standing rule forbids writing to a provider resource outside
 * production unless its name starts with `wetest-`, and a read cannot breach
 * it.
 *
 * **The result is reported, never inferred.** A product area that answers 404
 * is recorded as 404 with the provider's own words. It is not quietly dropped
 * and it is not rendered as "no websites" — an empty list and a wrong question
 * look identical on a screen, and only one of them is the customer's truth.
 */

export type VerificationReport = {
  accountId: string;
  checkedAt: Date;
  /** True when at least one product area answered successfully. */
  usable: boolean;
  credential: { id: string; label: string; lastFour: string | null };
  areas: ProbeOutcome[];
};

@Injectable()
export class ProviderVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly accounts: ProviderAccountsService,
    private readonly rateLimiter: ProviderRateLimiter,
  ) {}

  async verify(principal: Principal, accountId: string): Promise<VerificationReport> {
    const account = await this.prisma.hostingAccount.findUnique({
      where: { id: accountId },
      select: { id: true, accountName: true },
    });
    if (!account) throw notFound('provider account');

    const credential = await this.prisma.apiCredential.findFirst({
      where: {
        hostingAccountId: accountId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, label: true, lastFour: true },
    });
    if (!credential) throw notFound('active credential');

    // Decrypted here and held only for the duration of the probes. The service
    // that owns decryption stays the only thing that can do it.
    const token = await this.accounts.activeToken(accountId);

    const areas: ProbeOutcome[] = [];
    for (const { area, path } of PROBES) {
      // Through the same budget every other provider call uses, so a
      // connection test cannot exhaust the account's allowance.
      await this.rateLimiter.acquire(accountId);
      areas.push(await probe(token, area, path));
    }

    const usable = areas.some((outcome) => outcome.ok);
    const checkedAt = new Date();

    // Whatever happened is written down. A failure recorded is a failure an
    // operator can see on the page without reading a log.
    const failed = areas.filter((outcome) => !outcome.ok);
    await this.prisma.hostingAccount.update({
      where: { id: accountId },
      data: {
        lastSyncedAt: checkedAt,
        lastErrorAt: usable ? null : checkedAt,
        lastError: usable
          ? null
          : (failed[0]?.detail ?? 'The provider answered nothing this call could use.'),
      },
    });

    if (usable) {
      await this.prisma.apiCredential.update({
        where: { id: credential.id },
        data: { lastVerifiedAt: checkedAt },
      });
    }

    await this.activity.record(principal, {
      action: 'admin.provider_account.verified',
      resourceType: 'hosting_account',
      resourceId: accountId,
      // The trail records which areas answered, never the token. `lastFour`
      // is already public on the page.
      newValue: {
        usable,
        credentialLabel: credential.label,
        areas: areas.map((outcome) => ({ area: outcome.area, status: outcome.status, ok: outcome.ok })),
      },
    });

    return { accountId, checkedAt, usable, credential, areas };
  }
}
