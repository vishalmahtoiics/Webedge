import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, Realm } from '@prisma/client';
import { TenantScope } from '../src/common/tenant-scope';
import { PrismaService } from '../src/prisma/prisma.service';
import type { CustomerPrincipal, AdminPrincipal } from '../src/common/principal';

/**
 * Cross-tenant isolation, proven against a real database rather than mocks.
 *
 * Seeds Customer A and Customer B with their own resources, then has A attempt
 * every read path against B's ids. Every one must report not-found — not
 * forbidden, because a 403 confirms the id exists and turns resource ids into an
 * enumeration oracle.
 *
 * Needs a live database: DATABASE_URL must point at a migrated schema.
 */
describe('tenant isolation', () => {
  const prisma = new PrismaClient() as PrismaService;
  const scope = new TenantScope(prisma);

  let customerA: string;
  let customerB: string;
  let websiteB: string;
  let domainB: string;
  let principalA: CustomerPrincipal;

  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    await prisma.$connect();

    const role = await prisma.role.findFirstOrThrow({
      where: { realm: Realm.CUSTOMER, name: 'CUSTOMER' },
    });

    const a = await prisma.customer.create({
      data: { fullName: 'Customer A', email: `a-${suffix}@isolation.test`, status: 'ACTIVE' },
    });
    const b = await prisma.customer.create({
      data: { fullName: 'Customer B', email: `b-${suffix}@isolation.test`, status: 'ACTIVE' },
    });
    customerA = a.id;
    customerB = b.id;

    const userA = await prisma.customerUser.create({
      data: {
        customerId: a.id,
        email: `user-a-${suffix}@isolation.test`,
        fullName: 'A User',
        passwordHash: 'x',
        roleId: role.id,
        status: 'ACTIVE',
      },
    });

    const wB = await prisma.website.create({
      data: { customerId: b.id, domain: `b-site-${suffix}.test`, status: 'ACTIVE' },
    });
    const dB = await prisma.domain.create({
      data: { customerId: b.id, name: `b-domain-${suffix}.test`, status: 'ACTIVE' },
    });
    websiteB = wB.id;
    domainB = dB.id;

    // A gets resources too, so a passing test cannot be explained by A simply
    // having nothing at all.
    await prisma.website.create({
      data: { customerId: a.id, domain: `a-site-${suffix}.test`, status: 'ACTIVE' },
    });

    principalA = {
      realm: Realm.CUSTOMER,
      userId: userA.id,
      customerId: a.id,
      email: userA.email,
      roleId: role.id,
      roleName: 'CUSTOMER',
      permissions: new Set(['websites.view', 'domains.view']),
    };
  });

  afterAll(async () => {
    await prisma.website.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.domain.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.customerUser.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerA, customerB] } } });
    await prisma.$disconnect();
  });

  it('lets a customer read their own resources', async () => {
    const { items, total } = await scope.listOwned(principalA, 'website');
    expect(total).toBe(1);
    expect(items).toHaveLength(1);
  });

  it("reports another customer's website as not found", async () => {
    await expect(scope.findOwned(principalA, 'website', websiteB)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it("reports another customer's domain as not found", async () => {
    await expect(scope.findOwned(principalA, 'domain', domainB)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('gives the same answer for a foreign id as for one that does not exist', async () => {
    const foreign = await scope
      .findOwned(principalA, 'website', websiteB)
      .catch((e: { response: { code: string } }) => e.response.code);
    const missing = await scope
      .findOwned(principalA, 'website', '00000000-0000-4000-8000-000000000000')
      .catch((e: { response: { code: string } }) => e.response.code);

    // Identical responses are what stop resource ids becoming an enumeration
    // oracle — the whole reason this is 404 and not 403.
    expect(foreign).toBe(missing);
    expect(foreign).toBe('RESOURCE_NOT_FOUND');
  });

  it('never lists another customer in the results', async () => {
    const { items } = await scope.listOwned<{ customerId: string }>(principalA, 'website', {
      take: 100,
    });
    expect(items.every((w) => w.customerId === customerA)).toBe(true);
  });

  /**
   * The scope is applied last when building the query, so a caller-supplied
   * filter cannot overwrite it. Without that ordering, a `where` reaching the
   * helper from a request would be a full tenant bypass.
   */
  it('ignores a caller-supplied customerId filter', async () => {
    const { items, total } = await scope.listOwned<{ customerId: string }>(principalA, 'website', {
      where: { customerId: customerB },
    });

    expect(total).toBe(1);
    expect(items.every((w) => w.customerId === customerA)).toBe(true);
  });

  it('caps page size so a single request cannot drain the table', async () => {
    const { items } = await scope.listOwned(principalA, 'website', { take: 5000 });
    expect(items.length).toBeLessThanOrEqual(100);
  });

  it('gives a staff session with no impersonation context no tenant reach', async () => {
    const staff: AdminPrincipal = {
      realm: Realm.ADMIN,
      userId: '00000000-0000-4000-8000-00000000000a',
      email: 'staff@webedgesolution.com',
      roleId: '00000000-0000-4000-8000-00000000000b',
      roleName: 'SUPPORT_STAFF',
      permissions: new Set(['admin.customers']),
    };

    await expect(scope.findOwned(staff, 'website', websiteB)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('scopes an impersonating staff session to the impersonated customer only', async () => {
    const impersonating: AdminPrincipal = {
      realm: Realm.ADMIN,
      userId: '00000000-0000-4000-8000-00000000000a',
      email: 'staff@webedgesolution.com',
      roleId: '00000000-0000-4000-8000-00000000000b',
      roleName: 'SUPER_ADMIN',
      permissions: new Set(['admin.impersonate']),
      impersonating: { customerId: customerB, readOnly: true },
    };

    // Reaches B, whom they are impersonating...
    await expect(scope.findOwned(impersonating, 'website', websiteB)).resolves.toBeTruthy();

    // ...but not A, whom they are not.
    const { items } = await scope.listOwned<{ customerId: string }>(impersonating, 'website', {
      take: 100,
    });
    expect(items.every((w) => w.customerId === customerB)).toBe(true);
  });
});
