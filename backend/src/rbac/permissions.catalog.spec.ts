import { describe, expect, it } from 'vitest';
import { Realm } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, PERMISSION_KEYS } from './permissions.catalog';

const REALM_OF_ROLE: Record<string, Realm> = {
  ADMIN: Realm.ADMIN,
  SUPPORT_STAFF: Realm.ADMIN,
  CUSTOMER: Realm.CUSTOMER,
};

const realmByKey = new Map(PERMISSIONS.map((p) => [p.key, p.realm]));

describe('permission catalog', () => {
  it('has no duplicate keys', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('gives every permission a module and a description', () => {
    for (const p of PERMISSIONS) {
      expect(p.module, `${p.key} is missing a module`).toBeTruthy();
      expect(p.description, `${p.key} is missing a description`).toBeTruthy();
    }
  });

  /**
   * Seeding filters role permissions by realm, so a staff role listing a
   * customer-realm key does not fail loudly — the key is silently dropped and
   * the role ships with fewer permissions than intended. That actually happened:
   * SUPPORT_STAFF was given `support.view`/`support.reply`/`support.assign`, all
   * customer-realm, and seeded with no ticket access at all.
   */
  it('never composes a role from another realm\'s keys', () => {
    for (const [roleName, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const roleRealm = REALM_OF_ROLE[roleName];
      expect(roleRealm, `${roleName} has no realm mapping in this test`).toBeDefined();

      for (const key of keys) {
        expect(realmByKey.get(key), `${roleName} references unknown permission "${key}"`).toBeDefined();
        expect(
          realmByKey.get(key),
          `${roleName} (${roleRealm}) references "${key}" from the ${realmByKey.get(key)} realm; ` +
            'seeding would drop it silently',
        ).toBe(roleRealm);
      }
    }
  });

  it('references only keys that exist in the catalog', () => {
    for (const [roleName, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const key of keys) {
        expect(PERMISSION_KEYS.has(key), `${roleName} references unknown key "${key}"`).toBe(true);
      }
    }
  });

  it('withholds the keys to the kingdom from the operational ADMIN role', () => {
    const adminKeys = DEFAULT_ROLE_PERMISSIONS.ADMIN ?? [];
    for (const restricted of [
      'admin.permissions',
      'admin.providers.credentials',
      'admin.impersonate',
    ]) {
      expect(adminKeys, `ADMIN must not hold ${restricted}`).not.toContain(restricted);
    }
  });

  it('gives support staff real ticket access', () => {
    const keys = DEFAULT_ROLE_PERMISSIONS.SUPPORT_STAFF ?? [];
    expect(keys).toContain('admin.support.view');
    expect(keys).toContain('admin.support.reply');
  });

  it('keeps destructive and billing powers away from support staff', () => {
    const keys = DEFAULT_ROLE_PERMISSIONS.SUPPORT_STAFF ?? [];
    for (const restricted of [
      'admin.customers.suspend',
      'admin.billing',
      'admin.billing.refund',
      'admin.providers.credentials',
      'admin.impersonate',
      'admin.system_settings',
    ]) {
      expect(keys, `SUPPORT_STAFF must not hold ${restricted}`).not.toContain(restricted);
    }
  });

  it('grants the customer role only customer-realm keys', () => {
    for (const key of DEFAULT_ROLE_PERMISSIONS.CUSTOMER ?? []) {
      expect(realmByKey.get(key), `${key} is not a customer permission`).toBe(Realm.CUSTOMER);
    }
  });
});
