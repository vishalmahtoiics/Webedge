import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, Realm } from '@prisma/client';
import { ActivityService } from '../src/activity/activity.service';
import { ActivityReadService, isSecurityAction } from '../src/activity/activity-read.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AdminPrincipal, CustomerPrincipal } from '../src/common/principal';

/**
 * Reading the audit trail, against the real database.
 *
 * The trail is the one table that records what everybody did, so the read path
 * is where a disclosure would happen: one missing filter hands a customer the
 * internal trail, or hands them another tenant's. Both are checked here by
 * seeding two customers and reading as one of them.
 */
describe('activity trail reads', () => {
  const prisma = new PrismaClient() as PrismaService;
  const write = new ActivityService(prisma);
  const read = new ActivityReadService(prisma);

  const suffix = Date.now().toString(36);
  let customerA: string;
  let customerB: string;
  let principalA: CustomerPrincipal;
  let staff: AdminPrincipal;

  beforeAll(async () => {
    await prisma.$connect();

    const role = await prisma.role.findFirstOrThrow({
      where: { realm: Realm.CUSTOMER, name: 'CUSTOMER' },
    });

    const a = await prisma.customer.create({
      data: { fullName: 'Trail A', email: `trail-a-${suffix}@isolation.test`, status: 'ACTIVE' },
    });
    const b = await prisma.customer.create({
      data: { fullName: 'Trail B', email: `trail-b-${suffix}@isolation.test`, status: 'ACTIVE' },
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

    principalA = {
      realm: Realm.CUSTOMER,
      userId: userA.id,
      customerId: a.id,
      email: userA.email,
      roleId: role.id,
      roleName: 'CUSTOMER',
      permissions: new Set(['activity.view']),
    };

    staff = {
      realm: Realm.ADMIN,
      userId: '00000000-0000-4000-8000-00000000000a',
      email: `staff-${suffix}@webedgesolution.com`,
      roleId: '00000000-0000-4000-8000-00000000000b',
      roleName: 'SUPER_ADMIN',
      permissions: new Set(['admin.logs', 'admin.security_logs']),
    };

    // A's own action, which A should see.
    await write.record(principalA, {
      action: 'dns.record.updated',
      customerId: a.id,
      visibility: 'CUSTOMER',
      newValue: { value: '203.0.113.9' },
    });

    // Staff acting on A, visible to A but attributed to support rather than to
    // a named employee.
    await write.record(staff, {
      action: 'billing.invoice.issued',
      customerId: a.id,
      visibility: 'CUSTOMER',
      newValue: { invoiceNumber: 'WEB/2099-00/00001' },
    });

    // Internal detail about A, which A must not see.
    await write.record(staff, {
      action: 'admin.customer.status_changed',
      customerId: a.id,
      visibility: 'INTERNAL',
      newValue: { status: 'SUSPENDED', note: 'chargeback risk' },
    });

    // B's action, which A must not see even though it is CUSTOMER-visible.
    await write.record(staff, {
      action: 'billing.invoice.issued',
      customerId: b.id,
      visibility: 'CUSTOMER',
      newValue: { invoiceNumber: 'WEB/2099-00/00002' },
    });

    // A security action, for the trail split.
    await write.record(staff, {
      action: 'admin.provider_credential.added',
      customerId: a.id,
      visibility: 'INTERNAL',
      newValue: { label: 'primary' },
    });
  });

  afterAll(async () => {
    await prisma.customerUser.deleteMany({ where: { customerId: { in: [customerA, customerB] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [customerA, customerB] } } });
    await prisma.$disconnect();
  });

  describe('what a customer can read', () => {
    it('returns their own customer-visible entries', async () => {
      const { items } = await read.listForCustomer(principalA, { take: 100 });
      const actions = items.map((i) => i.action);

      expect(actions).toContain('dns.record.updated');
      expect(actions).toContain('billing.invoice.issued');
    });

    /**
     * INTERNAL rows record how WebEdge operates and why — here, that a customer
     * was flagged for chargeback risk. Showing one to the customer it concerns
     * is a disclosure, not a transparency feature.
     */
    it('never returns an internal entry', async () => {
      const { items } = await read.listForCustomer(principalA, { take: 100 });

      expect(items.map((i) => i.action)).not.toContain('admin.customer.status_changed');
      expect(JSON.stringify(items)).not.toContain('chargeback risk');
    });

    it("never returns another customer's entry", async () => {
      const { items } = await read.listForCustomer(principalA, { take: 100 });

      expect(JSON.stringify(items)).not.toContain('WEB/2099-00/00002');
    });

    /**
     * A staff address identifies a named employee to an outside party, and is
     * also a valid address to attack. The customer's own user is named.
     */
    it('names the customer’s own user but not the staff member', async () => {
      const { items } = await read.listForCustomer(principalA, { take: 100 });

      const own = items.find((i) => i.action === 'dns.record.updated');
      const byStaff = items.find((i) => i.action === 'billing.invoice.issued');

      expect(own?.actor).toBe(principalA.email);
      expect(byStaff?.actor).toBe('WebEdge support');
      expect(JSON.stringify(items)).not.toContain(staff.email);
    });

    it('caps the page size', async () => {
      const { items } = await read.listForCustomer(principalA, { take: 5000 });
      expect(items.length).toBeLessThanOrEqual(100);
    });

    it('gives a staff session with no impersonation context no trail to read', async () => {
      await expect(read.listForCustomer(staff, {})).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('the security trail', () => {
    it('classifies by what an action concerns, not by a list of known actions', () => {
      for (const action of [
        'auth.admin.signed_in',
        'admin.provider_credential.revoked',
        'admin.website.sftp_configured',
        // None of these exist yet. The point of a rule is that they do not have
        // to: an action added later is classified without anyone remembering.
        'admin.role.permissions_changed',
        'admin.user.password_reset',
        'admin.impersonation.started',
      ]) {
        expect(isSecurityAction(action), action).toBe(true);
      }

      for (const action of ['dns.record.updated', 'files.saved', 'billing.invoice.issued']) {
        expect(isSecurityAction(action), action).toBe(false);
      }
    });

    it('puts a credential change in the security trail and not the ordinary one', async () => {
      const ordinary = await read.listForStaff({ customerId: customerA, take: 100 });
      const security = await read.listSecurityForStaff({ customerId: customerA, take: 100 });

      expect(security.items.map((i) => i.action)).toContain('admin.provider_credential.added');
      expect(ordinary.items.map((i) => i.action)).not.toContain('admin.provider_credential.added');
    });

    /**
     * The two trails must partition the table. If they merely overlapped or left
     * a gap, an action could be invisible in both views while still being
     * recorded — a trail nobody reads is the same as no trail.
     */
    it('together account for every entry, with none in both', async () => {
      const ordinary = await read.listForStaff({ customerId: customerA, take: 100 });
      const security = await read.listSecurityForStaff({ customerId: customerA, take: 100 });
      const total = await prisma.activityLog.count({ where: { customerId: customerA } });

      expect(ordinary.total + security.total).toBe(total);

      const ids = new Set(ordinary.items.map((i) => i.id));
      expect(security.items.some((i) => ids.has(i.id))).toBe(false);
    });

    it('lets staff read the internal detail a customer cannot', async () => {
      const { items } = await read.listForStaff({ customerId: customerA, take: 100 });

      expect(items.map((i) => i.action)).toContain('admin.customer.status_changed');
      expect(JSON.stringify(items)).toContain('chargeback risk');
    });
  });
});
