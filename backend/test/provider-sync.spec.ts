import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ActivityService } from '../src/activity/activity.service';
import { CredentialCipherService } from '../src/providers/credential-cipher.service';
import { ProviderAccountsService } from '../src/providers/provider-accounts.service';
import { ProviderRateLimiter } from '../src/providers/rate-limiter.service';
import { ProviderSyncService } from '../src/providers/provider-sync.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AdminPrincipal } from '../src/common/principal';

/**
 * Pulling a provider account's contents into WebEdge, against the real
 * database.
 *
 * The provider itself is stubbed — not to avoid the network, but because the
 * properties worth asserting are about what WebEdge does with a payload, and
 * the payload shape is the one thing the provider does not publish. Stubbing
 * lets the awkward shapes be tested: the record with no id, the one whose name
 * uses a word nobody guessed, the second sync that must not duplicate the
 * first.
 *
 * The rule underneath all of it: **a discovered resource is not a customer's.**
 * It lands in the staff-side inventory, never in `Domain` or `Website`, because
 * those carry a tenant and nothing here knows one.
 */
describe('provider sync', () => {
  const prisma = new PrismaClient() as PrismaService;
  const activity = new ActivityService(prisma);
  const cipher = new CredentialCipherService();
  const rateLimiter = new ProviderRateLimiter();
  const accounts = new ProviderAccountsService(prisma, cipher, activity, rateLimiter);
  const sync = new ProviderSyncService(prisma, activity, accounts, rateLimiter);

  const suffix = Date.now().toString(36);
  let accountId: string;
  /**
   * A customer exists for the whole suite so that a leak into the
   * customer-owned tables is *possible*. Without one, `Domain` requires a
   * tenant that nothing could supply, and the tenancy assertion would pass in a
   * database where the mistake it guards against could not be made — which is
   * the most comfortable kind of worthless test.
   */
  let customerId: string;

  const principal: AdminPrincipal = {
    realm: 'ADMIN',
    userId: '00000000-0000-4000-8000-00000000000a',
    email: 'admin@webedgesolution.com',
    roleId: '00000000-0000-4000-8000-00000000000b',
    roleName: 'SUPER_ADMIN',
    permissions: new Set<string>(),
  };

  /**
   * Answers one product area and refuses the rest with 404.
   *
   * Path-aware rather than blanket, because an account really does have some
   * products and not others — and answering every path with the same body
   * stores one record four times over, once per kind, which is correct
   * behaviour against a fixture that could not happen.
   */
  function stubProvider(rows: unknown, status = 200, forPath = '/api/domains/v1/portfolio') {
    const answer = (body: unknown, code: number) =>
      Promise.resolve({
        ok: code >= 200 && code < 300,
        status: code,
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body),
      } as Response);

    vi.stubGlobal('fetch', (url: string) =>
      String(url).includes(forPath)
        ? answer(rows, status)
        : answer({ message: 'not found' }, 404),
    );
  }

  const inventory = () =>
    prisma.discoveredResource.findMany({
      where: { hostingAccountId: accountId },
      orderBy: { providerKey: 'asc' },
    });

  beforeAll(async () => {
    await prisma.$connect();
    const created = await accounts.create(principal, {
      accountName: `Sync test ${suffix}`,
      productFamily: 'shared',
    });
    accountId = created.id;

    const customer = await prisma.customer.create({
      data: {
        fullName: 'Sync Fixture',
        email: `sync-${suffix}@isolation.test`,
        status: 'ACTIVE',
        billingState: '27',
      },
    });
    customerId = customer.id;
    await accounts.addCredential(principal, accountId, {
      label: 'test',
      token: `token-for-sync-${suffix}`,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    // The limiter is real and shared across these tests. A sync spends five of
    // the account's sixty calls a minute, and this suite runs about twenty
    // syncs — so without a reset the later tests sit waiting for a window that
    // will not open before the timeout. That is the limiter working, not a
    // fault, which is why it is reset rather than removed.
    rateLimiter.reset();
    await prisma.discoveredResource.deleteMany({ where: { hostingAccountId: accountId } });
  });

  afterAll(async () => {
    await prisma.domain.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.discoveredResource.deleteMany({ where: { hostingAccountId: accountId } });
    await prisma.apiCredential.deleteMany({ where: { hostingAccountId: accountId } });
    await prisma.hostingAccount.deleteMany({ where: { id: accountId } });
    await prisma.$disconnect();
  });

  describe('storing what was found', () => {
    it('stores a readable payload', async () => {
      stubProvider([
        { id: 'd1', domain: 'first.test', status: 'active', expires_at: '2027-05-01' },
        { id: 'd2', domain: 'second.test', status: 'active' },
      ]);

      const report = await sync.sync(principal, accountId);

      expect(report.totalStored).toBeGreaterThan(0);
      const rows = await inventory();
      const names = rows.map((row) => row.name);
      expect(names).toContain('first.test');
      expect(names).toContain('second.test');
    });

    /**
     * The point of the whole feature. A second sync updates rather than
     * duplicating, so the inventory is a picture of the account and not a log
     * of every time somebody pressed the button.
     */
    it('does not duplicate on a second sync', async () => {
      stubProvider([{ id: 'd1', domain: 'first.test', status: 'active' }]);

      await sync.sync(principal, accountId);
      const afterFirst = await inventory();

      await sync.sync(principal, accountId);
      const afterSecond = await inventory();

      expect(afterSecond).toHaveLength(afterFirst.length);
    });

    /** When it first appeared on the account, which re-reading does not change. */
    it('keeps the date a resource was first seen', async () => {
      stubProvider([{ id: 'd1', domain: 'first.test' }]);

      await sync.sync(principal, accountId);
      const [first] = await inventory();

      await new Promise((resolve) => setTimeout(resolve, 10));
      await sync.sync(principal, accountId);
      const [second] = await inventory();

      expect(second?.firstSeenAt.toISOString()).toBe(first?.firstSeenAt.toISOString());
      expect(second!.lastSeenAt.getTime()).toBeGreaterThan(first!.lastSeenAt.getTime());
    });

    it('reflects a resource that changed upstream', async () => {
      stubProvider([{ id: 'd1', domain: 'first.test', status: 'active' }]);
      await sync.sync(principal, accountId);

      stubProvider([{ id: 'd1', domain: 'first.test', status: 'expired' }]);
      await sync.sync(principal, accountId);

      const [row] = await inventory();
      expect(row?.status).toBe('expired');
    });
  });

  describe('a payload nobody can fully read', () => {
    /**
     * The case this design exists for. A provider whose keys nobody guessed
     * still produces rows — with a null name and the payload kept — rather
     * than an empty inventory that reads as "this account has nothing".
     */
    it('stores a record whose name it cannot resolve, and says so', async () => {
      stubProvider([{ id: 'x1', libelle: 'mystere.test', etat: 'actif' }]);

      const report = await sync.sync(principal, accountId);

      const rows = await inventory();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBeNull();
      expect(rows[0]?.mapped).toEqual(['id']);
      // Kept, so a corrected mapping is applied to this without re-syncing.
      expect(rows[0]?.raw).toMatchObject({ libelle: 'mystere.test' });

      const domains = report.sources.find((source) => source.area === 'domains');
      expect(domains?.unnamed).toBe(1);
      // And the fix is handed over: the provider's own key names.
      expect(domains?.payloadKeys).toContain('libelle');
    });

    /** No stable key means no row: it would duplicate on every sync. */
    it('skips a record it could not key, and counts it', async () => {
      stubProvider([{ colour: 'blue' }, { id: 'ok1', domain: 'fine.test' }]);

      const report = await sync.sync(principal, accountId);

      expect(await inventory()).toHaveLength(1);
      const domains = report.sources.find((source) => source.area === 'domains');
      expect(domains?.received).toBe(2);
      expect(domains?.stored).toBe(1);
      expect(domains?.skipped).toBe(1);
    });

    /**
     * An unreadable response is not an empty account. Reporting it as zero
     * stored with `received: null` keeps the two distinguishable on the page.
     */
    it('separates an unreadable response from an empty one', async () => {
      stubProvider({ total: 4 });
      const unreadable = await sync.sync(principal, accountId);
      expect(unreadable.sources[0]?.received).toBeNull();
      expect(await inventory()).toHaveLength(0);

      stubProvider([]);
      const empty = await sync.sync(principal, accountId);
      expect(empty.sources[0]?.received).toBe(0);
    });

    it('records a product the account does not have as refused, not empty', async () => {
      stubProvider({ message: 'not found' }, 404);

      const report = await sync.sync(principal, accountId);
      // Every area, not just the one the stub would otherwise answer.

      for (const source of report.sources) {
        expect(source.ok).toBe(false);
        expect(source.status).toBe(404);
        expect(source.received).toBeNull();
      }
      expect(await inventory()).toHaveLength(0);
    });
  });

  describe('tenancy', () => {
    /**
     * Nothing discovered may enter a customer-owned table. `Domain` and
     * `Website` carry a non-null tenant, and a sync knows no customer — a row
     * there would be either untenanted or attributed to someone arbitrarily,
     * and both are breaches that no later scoping can undo.
     */
    it('writes nothing into the customer-owned tables', async () => {
      // A customer exists (see the fixture), so writing a discovered domain
      // into `Domain` would succeed if anything tried. The assertion is that
      // nothing does.
      expect(await prisma.customer.count({ where: { id: customerId } })).toBe(1);

      const domainsBefore = await prisma.domain.count();
      const websitesBefore = await prisma.website.count();

      stubProvider([{ id: 'd1', domain: 'first.test', status: 'active' }]);
      await sync.sync(principal, accountId);

      expect(await prisma.domain.count()).toBe(domainsBefore);
      expect(await prisma.website.count()).toBe(websitesBefore);
      expect((await inventory()).length).toBeGreaterThan(0);
    });

    it('leaves every discovered resource unclaimed', async () => {
      stubProvider([{ id: 'd1', domain: 'first.test' }]);
      await sync.sync(principal, accountId);

      for (const row of await inventory()) {
        expect(row.claimedByCustomerId).toBeNull();
      }
    });
  });

  describe('what the trail says', () => {
    it('records the sync without the token', async () => {
      stubProvider([{ id: 'd1', domain: 'first.test' }]);
      await sync.sync(principal, accountId);

      const row = await prisma.activityLog.findFirstOrThrow({
        where: { resourceId: accountId, action: 'admin.provider_account.synced' },
        orderBy: { createdAt: 'desc' },
      });

      expect(JSON.stringify(row.newValue)).not.toContain(`token-for-sync-${suffix}`);
    });
  });
});
