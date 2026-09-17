/**
 * Idempotent seed: permission catalog, system roles, and a first SUPER_ADMIN.
 *
 * Safe to re-run. Adding a permission to the catalog and re-seeding grants it to
 * SUPER_ADMIN automatically, so the role that is meant to have everything never
 * silently falls behind the catalog.
 *
 *   node --experimental-strip-types prisma/seed.ts
 */
import { PrismaClient, Realm } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../src/rbac/permissions.catalog.ts';

const prisma = new PrismaClient();

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

async function seedPermissions(): Promise<void> {
  for (const definition of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: definition.key },
      create: definition,
      update: {
        module: definition.module,
        realm: definition.realm,
        description: definition.description,
      },
    });
  }
  console.log(`  permissions: ${PERMISSIONS.length}`);
}

async function seedRole(
  realm: Realm,
  name: string,
  description: string,
  permissionKeys: string[],
): Promise<string> {
  const role = await prisma.role.upsert({
    where: { realm_name: { realm, name } },
    create: { realm, name, description, isSystem: true },
    update: { description, isSystem: true },
  });

  const permissions = await prisma.permission.findMany({
    where: { key: { in: permissionKeys }, realm },
    select: { id: true },
  });

  // Replace rather than append, so a key removed from the catalog is actually
  // revoked instead of lingering on the role.
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  console.log(`  role ${realm}/${name}: ${permissions.length} permissions`);
  return role.id;
}

async function main(): Promise<void> {
  console.log('Seeding WebEdge core data');

  await seedPermissions();

  const adminKeys = PERMISSIONS.filter((p) => p.realm === Realm.ADMIN).map((p) => p.key);

  const superAdminRoleId = await seedRole(
    Realm.ADMIN,
    'SUPER_ADMIN',
    'Full access, including provider credentials, roles and impersonation',
    adminKeys,
  );
  await seedRole(
    Realm.ADMIN,
    'ADMIN',
    'All operational modules; no credential access, role edits or impersonation',
    DEFAULT_ROLE_PERMISSIONS.ADMIN ?? [],
  );
  await seedRole(
    Realm.ADMIN,
    'SUPPORT_STAFF',
    'Read customers and resources; full ticket handling',
    DEFAULT_ROLE_PERMISSIONS.SUPPORT_STAFF ?? [],
  );
  await seedRole(
    Realm.CUSTOMER,
    'CUSTOMER',
    'Owns and manages their own resources, within plan limits',
    DEFAULT_ROLE_PERMISSIONS.CUSTOMER ?? [],
  );

  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@webedgesolution.com').toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { email } });

  if (existing) {
    console.log(`  super admin: ${email} (already exists, password unchanged)`);
  } else {
    // Generated rather than defaulted: a seeded well-known password is how
    // staging panels end up compromised.
    const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(15).toString('base64url');
    await prisma.adminUser.create({
      data: {
        email,
        fullName: process.env.SEED_ADMIN_NAME ?? 'WebEdge Super Admin',
        passwordHash: await argon2.hash(password, ARGON2_OPTIONS),
        roleId: superAdminRoleId,
        status: 'ACTIVE',
      },
    });

    console.log(`\n  Super admin created`);
    console.log(`    email:    ${email}`);
    if (!process.env.SEED_ADMIN_PASSWORD) {
      console.log(`    password: ${password}`);
      console.log(`    Shown once. Store it in a password manager and enable 2FA at first sign-in.`);
    }
  }

  await seedPlans();

  console.log('\nSeed complete.');
}

/**
 * The starting catalogue.
 *
 * Seeded idempotently by slug, and only ever created — never updated. Changing a
 * price here would silently reprice a plan an operator had already adjusted, and
 * a seed that overwrites production data is a seed nobody dares run.
 *
 * `providerProduct` records which upstream product fulfils each plan. It is
 * staff-only and never serialized to a customer.
 */
async function seedPlans(): Promise<void> {
  const plans = [
    {
      name: 'Starter',
      slug: 'starter',
      description: 'One website, for a first site or a personal project.',
      priceInPaise: 149_900,
      billingCycle: 'YEARLY' as const,
      maxWebsites: 1,
      maxDomains: 1,
      maxDatabases: 2,
      maxMailboxes: 5,
      storageGb: 25,
      mailboxQuotaGb: 2,
      providerProduct: 'agency-hosting',
    },
    {
      name: 'Business',
      slug: 'business',
      description: 'Room for a growing set of sites, with mail included.',
      priceInPaise: 449_900,
      billingCycle: 'YEARLY' as const,
      maxWebsites: 25,
      maxDomains: 25,
      maxDatabases: 50,
      maxMailboxes: 50,
      storageGb: 100,
      mailboxQuotaGb: 5,
      providerProduct: 'agency-hosting',
    },
    {
      name: 'Agency',
      slug: 'agency',
      description: 'For running client sites at volume.',
      priceInPaise: 1_199_900,
      billingCycle: 'YEARLY' as const,
      // Null is unlimited. Left unset rather than written as a large number:
      // "unlimited" and "one hundred" are different promises to a customer.
      maxWebsites: null,
      maxDomains: null,
      maxDatabases: null,
      maxMailboxes: 200,
      storageGb: 300,
      mailboxQuotaGb: 10,
      providerProduct: 'agency-hosting',
    },
  ];

  let created = 0;
  for (const plan of plans) {
    const existing = await prisma.hostingPlan.findUnique({
      where: { slug: plan.slug },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.hostingPlan.create({ data: plan });
    created += 1;
  }

  console.log(`  hosting plans: ${created} created, ${plans.length - created} already present`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
