import { Injectable } from '@nestjs/common';
import { ProviderAccountStatus, ProviderKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { CredentialCipherService } from './credential-cipher.service';
import { ProviderRateLimiter } from './rate-limiter.service';
import { resolveAll, isolatesWebsites, type ProductFamily } from './capabilities';
import { AppError, notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * Provider accounts and their credentials.
 *
 * Credentials are write-only from the API's point of view: they go in encrypted
 * and come back only as metadata — last four characters, dates, status. There is
 * deliberately no endpoint that returns a decrypted token, so no bug in a
 * controller can expose one. Only the adapter decrypts, server-side, at call
 * time (blueprint §6, §22).
 */

export type ProviderAccountSummary = {
  id: string;
  provider: ProviderKind;
  accountName: string;
  status: ProviderAccountStatus;
  productFamily: string | null;
  isolatesWebsites: boolean;
  websiteSlotsUsed: number;
  websiteSlotsTotal: number | null;
  lastSyncedAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  rateLimit: { remaining: number; limit: number };
  credentials: Array<{
    id: string;
    label: string;
    lastFour: string | null;
    keyVersion: string;
    expiresAt: Date | null;
    lastVerifiedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }>;
};

@Injectable()
export class ProviderAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly activity: ActivityService,
    private readonly rateLimiter: ProviderRateLimiter,
  ) {}

  async list(): Promise<ProviderAccountSummary[]> {
    const accounts = await this.prisma.hostingAccount.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        credentials: {
          orderBy: { createdAt: 'desc' },
          // Note the absent fields: ciphertext, iv and authTag are never
          // selected, so they cannot reach a response by accident.
          select: {
            id: true,
            label: true,
            lastFour: true,
            keyVersion: true,
            expiresAt: true,
            lastVerifiedAt: true,
            revokedAt: true,
            createdAt: true,
          },
        },
      },
    });

    return accounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      accountName: account.accountName,
      status: account.status,
      productFamily: account.productFamily,
      isolatesWebsites: isolatesWebsites((account.productFamily ?? 'unknown') as ProductFamily),
      websiteSlotsUsed: account.websiteSlotsUsed,
      websiteSlotsTotal: account.websiteSlotsTotal,
      lastSyncedAt: account.lastSyncedAt,
      lastErrorAt: account.lastErrorAt,
      lastError: account.lastError,
      rateLimit: {
        remaining: this.rateLimiter.remaining(account.id),
        limit: this.rateLimiter.limitFor('default'),
      },
      credentials: account.credentials,
    }));
  }

  async capabilities(accountId: string): Promise<Record<string, unknown>> {
    const account = await this.prisma.hostingAccount.findUnique({ where: { id: accountId } });
    if (!account) throw notFound('provider account');

    const family = (account.productFamily ?? 'unknown') as ProductFamily;
    return {
      productFamily: family,
      isolatesWebsites: isolatesWebsites(family),
      capabilities: resolveAll(family),
    };
  }

  async create(
    principal: Principal,
    input: { accountName: string; productFamily?: string; websiteSlotsTotal?: number; notes?: string },
  ): Promise<{ id: string }> {
    const account = await this.prisma.hostingAccount.create({
      data: {
        accountName: input.accountName,
        productFamily: input.productFamily ?? null,
        websiteSlotsTotal: input.websiteSlotsTotal ?? null,
        notes: input.notes ?? null,
      },
    });

    await this.activity.record(principal, {
      action: 'admin.provider_account.created',
      resourceType: 'hosting_account',
      resourceId: account.id,
      newValue: { accountName: input.accountName, productFamily: input.productFamily },
    });

    return { id: account.id };
  }

  /**
   * Stores a credential.
   *
   * Adding a credential does not revoke the previous one: rotation needs both
   * live at once so in-flight work finishes against the old token while new
   * calls use the new one. The old credential is revoked explicitly once the new
   * one has been verified.
   */
  async addCredential(
    principal: Principal,
    accountId: string,
    input: { label: string; token: string; expiresAt?: string },
  ): Promise<{ id: string; lastFour: string }> {
    const account = await this.prisma.hostingAccount.findUnique({ where: { id: accountId } });
    if (!account) throw notFound('provider account');

    const encrypted = this.cipher.encrypt(input.token);

    const credential = await this.prisma.apiCredential.create({
      data: {
        hostingAccountId: accountId,
        label: input.label,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        lastFour: encrypted.lastFour,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      },
      select: { id: true, lastFour: true },
    });

    await this.activity.record(principal, {
      action: 'admin.provider_credential.added',
      resourceType: 'api_credential',
      resourceId: credential.id,
      // The token itself is never passed to the logger; only its tail, which is
      // what the admin UI displays anyway.
      newValue: { accountName: account.accountName, label: input.label, lastFour: encrypted.lastFour },
    });

    return { id: credential.id, lastFour: credential.lastFour ?? '' };
  }

  async revokeCredential(principal: Principal, credentialId: string): Promise<void> {
    const credential = await this.prisma.apiCredential.findUnique({
      where: { id: credentialId },
      select: { id: true, label: true, revokedAt: true, hostingAccountId: true },
    });
    if (!credential) throw notFound('credential');
    if (credential.revokedAt) return;

    await this.prisma.apiCredential.update({
      where: { id: credentialId },
      data: { revokedAt: new Date() },
    });

    await this.activity.record(principal, {
      action: 'admin.provider_credential.revoked',
      resourceType: 'api_credential',
      resourceId: credentialId,
      oldValue: { label: credential.label },
    });
  }

  async setStatus(
    principal: Principal,
    accountId: string,
    status: ProviderAccountStatus,
  ): Promise<void> {
    const account = await this.prisma.hostingAccount.findUnique({ where: { id: accountId } });
    if (!account) throw notFound('provider account');

    await this.prisma.hostingAccount.update({ where: { id: accountId }, data: { status } });

    await this.activity.record(principal, {
      action: 'admin.provider_account.status_changed',
      resourceType: 'hosting_account',
      resourceId: accountId,
      oldValue: { status: account.status },
      newValue: { status },
    });
  }

  /**
   * Decrypts the active credential for adapter use.
   *
   * Internal only — there is no route that reaches this. Prefers the most
   * recently added unrevoked, unexpired credential, which is what makes
   * overlapping rotation work.
   */
  async activeToken(accountId: string): Promise<string> {
    const credential = await this.prisma.apiCredential.findFirst({
      where: {
        hostingAccountId: accountId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!credential) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        "We couldn't complete this right now. Try again in a few minutes.",
      );
    }

    return this.cipher.decrypt(credential);
  }
}
