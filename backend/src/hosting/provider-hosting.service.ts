import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { ProviderAccountsService } from '../providers/provider-accounts.service';
import { ProviderRateLimiter } from '../providers/rate-limiter.service';
import { read, write } from '../providers/hostinger.client';
import { assertWriteAllowed } from '../providers/provider-write-guard';
import { listOf } from '../providers/resource-mapping';
import { AppError, notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * Databases and mailboxes on the provider, and DNS records pushed to it.
 *
 * **Every path here was read from the provider's own MCP package**, including
 * the request bodies — they are not published anywhere else, and an invented
 * field name fails at the worst possible moment, which is halfway through a
 * change. See `docs/provider-api.md`.
 *
 * Everything that changes provider state goes through `assertWriteAllowed`
 * first. There is no sandbox: a delete here removes a real database belonging
 * to a real customer.
 *
 * What comes back is not trusted to have a known shape. The provider documents
 * no response bodies, so a list is found by `listOf` and an unreadable answer
 * is reported as unreadable rather than as an empty account.
 */

export type ProviderDatabase = {
  name: string;
  user: string | null;
  raw: Record<string, unknown>;
};

export type ProviderMailbox = {
  id: string | null;
  address: string | null;
  raw: Record<string, unknown>;
};

/** A DNS record as the provider's zone endpoint expects it. */
export type ZoneEntry = {
  name: string;
  type: string;
  ttl: number;
  records: Array<{ content: string }>;
};

@Injectable()
export class ProviderHostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly accounts: ProviderAccountsService,
    private readonly rateLimiter: ProviderRateLimiter,
  ) {}

  /**
   * Resolves the account a website sits on, its token, and whether writing to
   * it is permitted here.
   *
   * `providerUsername` is the hosting account username — the path segment every
   * database endpoint is scoped by. Without it there is nothing to address, and
   * guessing one would act on somebody else's account.
   */
  private async contextFor(websiteId: string) {
    const website = await this.prisma.website.findUnique({
      where: { id: websiteId },
      select: {
        id: true,
        domain: true,
        customerId: true,
        providerUsername: true,
        hostingAccountId: true,
        hostingAccount: { select: { id: true, accountName: true, isStaging: true } },
      },
    });
    if (!website) throw notFound('website');

    if (!website.providerUsername) {
      throw new AppError(
        'INVALID_REQUEST',
        'This website has no provider account username recorded, so there is nothing to address ' +
          'on the provider. Sync the account, or set it on the website.',
      );
    }
    if (!website.hostingAccountId || !website.hostingAccount) {
      throw new AppError('INVALID_REQUEST', 'This website is not attached to a provider account.');
    }

    return {
      website,
      username: website.providerUsername,
      accountId: website.hostingAccountId,
      isStaging: website.hostingAccount.isStaging,
    };
  }

  // ---------------------------------------------------------------- databases

  async listDatabases(websiteId: string): Promise<ProviderDatabase[]> {
    const { username, accountId } = await this.contextFor(websiteId);
    const token = await this.accounts.activeToken(accountId);
    await this.rateLimiter.acquire(accountId);

    const result = await read(token, `/api/hosting/v1/accounts/${encodeURIComponent(username)}/databases`);
    if (!result.ok) throw new AppError('PROVIDER_UNAVAILABLE', result.detail ?? 'Could not list databases.');

    const rows = listOf(result.data);
    if (rows === null) {
      // Not an empty list. The two must stay distinguishable, or "you have no
      // databases" is shown to someone who has several.
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        'The provider answered, but the list could not be read.',
      );
    }

    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const record = row as Record<string, unknown>;
      const name = typeof record['name'] === 'string' ? record['name'] : null;
      if (name === null) return [];
      return [{
        name,
        user: typeof record['user'] === 'string' ? record['user'] : null,
        raw: record,
      }];
    });
  }

  async createDatabase(
    principal: Principal,
    websiteId: string,
    input: { name: string; user: string; password: string },
  ) {
    const { website, username, accountId, isStaging } = await this.contextFor(websiteId);
    assertWriteAllowed({
      what: `create the database "${input.name}"`,
      resourceName: input.name,
      accountIsStaging: isStaging,
    });

    const token = await this.accounts.activeToken(accountId);
    await this.rateLimiter.acquire(accountId);

    const result = await write(
      token,
      'POST',
      `/api/hosting/v1/accounts/${encodeURIComponent(username)}/databases`,
      {
        name: input.name,
        user: input.user,
        password: input.password,
        website_domain: website.domain,
      },
    );
    if (!result.ok) {
      throw new AppError('OPERATION_FAILED', result.detail ?? 'The provider refused to create it.');
    }

    await this.activity.record(principal, {
      action: 'hosting.database.created',
      customerId: website.customerId,
      resourceType: 'database',
      resourceId: websiteId,
      visibility: 'CUSTOMER',
      // The password is absent deliberately. `activity_logs` is append-only,
      // so a credential recorded here could never be removed.
      newValue: { name: input.name, user: input.user, website: website.domain },
    });

    return { name: input.name, user: input.user };
  }

  async deleteDatabase(principal: Principal, websiteId: string, name: string) {
    const { website, username, accountId, isStaging } = await this.contextFor(websiteId);
    assertWriteAllowed({
      what: `delete the database "${name}"`,
      resourceName: name,
      accountIsStaging: isStaging,
    });

    const token = await this.accounts.activeToken(accountId);
    await this.rateLimiter.acquire(accountId);

    const result = await write(
      token,
      'DELETE',
      `/api/hosting/v1/accounts/${encodeURIComponent(username)}/databases/${encodeURIComponent(name)}`,
    );
    if (!result.ok) {
      throw new AppError('OPERATION_FAILED', result.detail ?? 'The provider refused to delete it.');
    }

    await this.activity.record(principal, {
      action: 'hosting.database.deleted',
      customerId: website.customerId,
      resourceType: 'database',
      resourceId: websiteId,
      visibility: 'CUSTOMER',
      oldValue: { name },
    });
  }

  async changeDatabasePassword(
    principal: Principal,
    websiteId: string,
    name: string,
    password: string,
  ) {
    const { website, username, accountId, isStaging } = await this.contextFor(websiteId);
    assertWriteAllowed({
      what: `change the password for database "${name}"`,
      resourceName: name,
      accountIsStaging: isStaging,
    });

    const token = await this.accounts.activeToken(accountId);
    await this.rateLimiter.acquire(accountId);

    const result = await write(
      token,
      'PATCH',
      `/api/hosting/v1/accounts/${encodeURIComponent(username)}/databases/${encodeURIComponent(name)}/change-password`,
      { password },
    );
    if (!result.ok) {
      throw new AppError('OPERATION_FAILED', result.detail ?? 'The provider refused the change.');
    }

    await this.activity.record(principal, {
      action: 'hosting.database.password_changed',
      customerId: website.customerId,
      resourceType: 'database',
      resourceId: websiteId,
      visibility: 'CUSTOMER',
      newValue: { name },
    });
  }

  /**
   * A one-time link into the provider's database tool.
   *
   * Fetched on demand and never stored: it authenticates whoever holds it, so
   * a copy in the database is a spare key, and one in the audit trail is a
   * spare key that cannot be deleted.
   */
  async phpMyAdminLink(websiteId: string, name: string): Promise<string> {
    const { username, accountId } = await this.contextFor(websiteId);
    const token = await this.accounts.activeToken(accountId);
    await this.rateLimiter.acquire(accountId);

    const result = await read<unknown>(
      token,
      `/api/hosting/v1/accounts/${encodeURIComponent(username)}/databases/${encodeURIComponent(name)}/phpmyadmin-link`,
    );
    if (!result.ok) {
      throw new AppError('PROVIDER_UNAVAILABLE', result.detail ?? 'Could not get a link.');
    }

    const body = result.data;
    const link =
      typeof body === 'string'
        ? body
        : body && typeof body === 'object'
          ? ((body as Record<string, unknown>)['link'] ??
             (body as Record<string, unknown>)['url'] ??
             (body as Record<string, unknown>)['data'])
          : undefined;

    if (typeof link !== 'string' || !link.startsWith('https://')) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        'The provider did not return a usable link.',
      );
    }
    return link;
  }

  // ---------------------------------------------------------------- mailboxes

  async listMailboxes(accountId: string, orderId: string): Promise<ProviderMailbox[]> {
    const token = await this.accounts.activeToken(accountId);
    await this.rateLimiter.acquire(accountId);

    const result = await read(token, `/api/mail/v1/orders/${encodeURIComponent(orderId)}/mailboxes`);
    if (!result.ok) throw new AppError('PROVIDER_UNAVAILABLE', result.detail ?? 'Could not list mailboxes.');

    const rows = listOf(result.data);
    if (rows === null) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        'The provider answered, but the list could not be read.',
      );
    }

    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const record = row as Record<string, unknown>;
      const id = record['id'] ?? record['uuid'] ?? record['mailbox_id'];
      const address = record['address'] ?? record['email'];
      return [{
        id: typeof id === 'string' || typeof id === 'number' ? String(id) : null,
        address: typeof address === 'string' ? address : null,
        raw: record,
      }];
    });
  }

  async createMailbox(
    principal: Principal,
    accountId: string,
    orderId: string,
    input: { localPart: string; password: string; customerId?: string },
  ) {
    const account = await this.prisma.hostingAccount.findUnique({
      where: { id: accountId },
      select: { isStaging: true },
    });
    if (!account) throw notFound('provider account');

    assertWriteAllowed({
      what: `create the mailbox "${input.localPart}"`,
      resourceName: input.localPart,
      accountIsStaging: account.isStaging,
    });

    const token = await this.accounts.activeToken(accountId);
    await this.rateLimiter.acquire(accountId);

    const result = await write(
      token,
      'POST',
      `/api/mail/v1/orders/${encodeURIComponent(orderId)}/mailboxes`,
      { local_part: input.localPart, password: input.password },
    );
    if (!result.ok) {
      throw new AppError('OPERATION_FAILED', result.detail ?? 'The provider refused to create it.');
    }

    await this.activity.record(principal, {
      action: 'mail.mailbox.created',
      customerId: input.customerId,
      resourceType: 'mailbox',
      resourceId: accountId,
      visibility: 'CUSTOMER',
      newValue: { localPart: input.localPart },
    });

    return result.data;
  }

  async deleteMailbox(
    principal: Principal,
    accountId: string,
    mailboxId: string,
    context?: { address?: string; customerId?: string },
  ) {
    const account = await this.prisma.hostingAccount.findUnique({
      where: { id: accountId },
      select: { isStaging: true },
    });
    if (!account) throw notFound('provider account');

    assertWriteAllowed({
      what: `delete the mailbox "${context?.address ?? mailboxId}"`,
      resourceName: context?.address,
      accountIsStaging: account.isStaging,
    });

    const token = await this.accounts.activeToken(accountId);
    await this.rateLimiter.acquire(accountId);

    const result = await write(
      token,
      'DELETE',
      `/api/mail/v1/mailboxes/${encodeURIComponent(mailboxId)}`,
    );
    if (!result.ok) {
      throw new AppError('OPERATION_FAILED', result.detail ?? 'The provider refused to delete it.');
    }

    await this.activity.record(principal, {
      action: 'mail.mailbox.deleted',
      customerId: context?.customerId,
      resourceType: 'mailbox',
      resourceId: accountId,
      visibility: 'CUSTOMER',
      oldValue: { address: context?.address ?? null, mailboxId },
    });
  }

  // --------------------------------------------------------------------- dns

  /**
   * Pushes WebEdge's records for a domain to the provider.
   *
   * `overwrite: true`, because the panel's copy is the intended state. Without
   * it the provider appends, so a record deleted in WebEdge stays live upstream
   * and the two drift apart silently — which is worse than either being wrong,
   * because neither screen shows it.
   */
  async pushZone(principal: Principal, domainId: string) {
    const domain = await this.prisma.domain.findUnique({
      where: { id: domainId },
      select: {
        id: true,
        name: true,
        customerId: true,
        dnsRecords: { select: { id: true, type: true, name: true, value: true, ttl: true } },
      },
    });
    if (!domain) throw notFound('domain');

    const account = await this.prisma.hostingAccount.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true, isStaging: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!account) {
      throw new AppError('INVALID_REQUEST', 'No active provider account is connected.');
    }

    assertWriteAllowed({
      what: `replace the DNS zone for ${domain.name}`,
      resourceName: domain.name,
      accountIsStaging: account.isStaging,
    });

    // Grouped by (name, type), which is the shape the zone endpoint takes: one
    // entry per name and type, carrying every value for it.
    const grouped = new Map<string, ZoneEntry>();
    for (const record of domain.dnsRecords) {
      const key = `${record.name}\u0000${record.type}`;
      const entry = grouped.get(key);
      if (entry) {
        entry.records.push({ content: record.value });
        // The shortest TTL wins: a set published with mixed TTLs is served
        // inconsistently, and the shorter one is the safer promise.
        entry.ttl = Math.min(entry.ttl, record.ttl);
      } else {
        grouped.set(key, {
          name: record.name,
          type: record.type,
          ttl: record.ttl,
          records: [{ content: record.value }],
        });
      }
    }

    const token = await this.accounts.activeToken(account.id);
    await this.rateLimiter.acquire(account.id);

    const result = await write(
      token,
      'PUT',
      `/api/dns/v1/zones/${encodeURIComponent(domain.name)}`,
      { overwrite: true, zone: [...grouped.values()] },
    );
    if (!result.ok) {
      throw new AppError('OPERATION_FAILED', result.detail ?? 'The provider refused the zone.');
    }

    const syncedAt = new Date();
    await this.prisma.dnsRecord.updateMany({
      where: { domainId },
      data: { providerSyncedAt: syncedAt },
    });

    await this.activity.record(principal, {
      action: 'dns.zone.published',
      customerId: domain.customerId,
      resourceType: 'domain',
      resourceId: domainId,
      visibility: 'CUSTOMER',
      newValue: { domain: domain.name, records: domain.dnsRecords.length },
    });

    return { published: domain.dnsRecords.length, syncedAt };
  }

  /** The zone as the provider currently holds it, for comparison. */
  async readZone(domainName: string, accountId: string): Promise<unknown[] | null> {
    const token = await this.accounts.activeToken(accountId);
    await this.rateLimiter.acquire(accountId);

    const result = await read(token, `/api/dns/v1/zones/${encodeURIComponent(domainName)}`);
    if (!result.ok) {
      throw new AppError('PROVIDER_UNAVAILABLE', result.detail ?? 'Could not read the zone.');
    }
    return listOf(result.data);
  }
}
