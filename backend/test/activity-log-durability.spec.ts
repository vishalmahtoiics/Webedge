import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, Realm } from '@prisma/client';
import { ActivityService } from '../src/activity/activity.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { CustomerPrincipal } from '../src/common/principal';

/**
 * The audit trail must outlive the accounts it records.
 *
 * Originally ActivityLog had real foreign keys to the actor with
 * `onDelete: SetNull`. That combination is unworkable alongside the append-only
 * trigger: deleting a user makes Postgres UPDATE activity_logs to null the
 * column, the trigger refuses, and the account becomes undeletable. Relaxing the
 * trigger instead would have meant an audit trail that quietly forgets who did
 * what the moment an account is removed — the opposite of the point.
 *
 * Actor columns are therefore plain ids with an email snapshot, and this test
 * pins that behaviour down.
 */
describe('activity log durability', () => {
  const prisma = new PrismaClient() as PrismaService;
  const activity = new ActivityService(prisma);

  const suffix = Date.now().toString(36);
  let customerId: string;
  let userId: string;
  const actorEmail = `durable-${suffix}@isolation.test`;

  beforeAll(async () => {
    await prisma.$connect();

    const role = await prisma.role.findFirstOrThrow({
      where: { realm: Realm.CUSTOMER, name: 'CUSTOMER' },
    });

    const customer = await prisma.customer.create({
      data: { fullName: 'Durability Co', email: `co-${suffix}@isolation.test`, status: 'ACTIVE' },
    });
    customerId = customer.id;

    const user = await prisma.customerUser.create({
      data: {
        customerId,
        email: actorEmail,
        fullName: 'Soon Deleted',
        passwordHash: 'x',
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    userId = user.id;

    const principal: CustomerPrincipal = {
      realm: Realm.CUSTOMER,
      userId,
      customerId,
      email: actorEmail,
      roleId: role.id,
      roleName: 'CUSTOMER',
      permissions: new Set(),
    };

    await activity.record(principal, {
      action: 'dns.record.updated',
      resourceType: 'dns_record',
      resourceId: 'rec_1',
      oldValue: { value: '203.0.113.1', apiKey: 'super-secret-token' },
      newValue: { value: '203.0.113.9', apiKey: 'super-secret-token' },
      visibility: 'CUSTOMER',
    });
  });

  afterAll(async () => {
    await prisma.customerUser.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.$disconnect();
  });

  it('redacts secrets but keeps the values that matter', async () => {
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { customerUserId: userId, action: 'dns.record.updated' },
    });

    const oldValue = entry.oldValue as Record<string, unknown>;
    const newValue = entry.newValue as Record<string, unknown>;

    expect(oldValue.apiKey).toBe('<redacted>');
    expect(newValue.apiKey).toBe('<redacted>');
    // The change itself is the reason the row exists, so it must survive.
    expect(oldValue.value).toBe('203.0.113.1');
    expect(newValue.value).toBe('203.0.113.9');

    expect(JSON.stringify(entry)).not.toContain('super-secret-token');
  });

  it('keeps the entry, its actor id and its email after the account is deleted', async () => {
    await prisma.customerUser.delete({ where: { id: userId } });

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { customerUserId: userId, action: 'dns.record.updated' },
    });

    // Still attributable, with no surviving account to join to.
    expect(entry.customerUserId).toBe(userId);
    expect(entry.actorEmail).toBe(actorEmail);
    expect(entry.customerId).toBe(customerId);

    const stillGone = await prisma.customerUser.findUnique({ where: { id: userId } });
    expect(stillGone).toBeNull();
  });

  it('refuses to let the application rewrite or erase an entry', async () => {
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { customerId, action: 'dns.record.updated' },
    });

    await expect(
      prisma.activityLog.update({ where: { id: entry.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);

    await expect(prisma.activityLog.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/,
    );
  });
});
