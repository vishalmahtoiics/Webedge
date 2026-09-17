import { Realm } from '@prisma/client';

/**
 * The complete permission catalog. Seeded idempotently; custom staff roles are
 * composed from these keys rather than free text.
 *
 * Permissions are realm-scoped. A CUSTOMER-realm role can only ever hold
 * CUSTOMER-realm keys, so granting a customer an `admin.*` permission is not
 * something the data model can express.
 */

export type PermissionDefinition = {
  key: string;
  module: string;
  realm: Realm;
  description: string;
};

const customer = (module: string, entries: Record<string, string>): PermissionDefinition[] =>
  Object.entries(entries).map(([key, description]) => ({
    key,
    module,
    realm: Realm.CUSTOMER,
    description,
  }));

const admin = (module: string, entries: Record<string, string>): PermissionDefinition[] =>
  Object.entries(entries).map(([key, description]) => ({
    key,
    module,
    realm: Realm.ADMIN,
    description,
  }));

export const PERMISSIONS: PermissionDefinition[] = [
  ...customer('dashboard', {
    'dashboard.view': 'View the customer dashboard',
  }),
  ...customer('websites', {
    'websites.view': 'View websites',
    'websites.create': 'Create a website',
    'websites.update': 'Update website settings',
    'websites.delete': 'Delete a website',
  }),
  ...customer('files', {
    'files.view': 'Browse files and folders',
    'files.download': 'Download files',
    'files.upload': 'Upload files',
    'files.create': 'Create files and folders',
    'files.edit': 'Edit file contents',
    'files.rename': 'Rename files and folders',
    'files.move': 'Move or copy files and folders',
    'files.delete': 'Delete files and folders',
  }),
  ...customer('database', {
    'database.view': 'View databases',
    'database.create': 'Create a database',
    'database.update': 'Update a database or change its password',
    'database.delete': 'Delete a database',
  }),
  ...customer('domains', {
    'domains.view': 'View domains',
    'domains.create': 'Add or register a domain',
    'domains.update': 'Update domain settings',
    'domains.delete': 'Remove a domain',
    'domains.nameservers': 'Change nameservers',
  }),
  ...customer('dns', {
    'dns.view': 'View DNS records',
    'dns.create': 'Create a DNS record',
    'dns.update': 'Update a DNS record',
    'dns.delete': 'Delete a DNS record',
  }),
  ...customer('ssl', {
    'ssl.view': 'View SSL certificate status',
    'ssl.manage': 'Manage SSL certificates',
  }),
  ...customer('storage', {
    'storage.view': 'View storage usage',
  }),
  ...customer('backup', {
    'backup.view': 'View backups',
    'backup.create': 'Create a backup',
    'backup.restore': 'Restore a backup',
    'backup.delete': 'Delete a backup',
  }),
  ...customer('email', {
    'email.view': 'View mailboxes',
    'email.create': 'Create a mailbox',
    'email.update': 'Update a mailbox',
    'email.delete': 'Delete a mailbox',
    'email.password_change': 'Change a mailbox password',
  }),
  ...customer('billing', {
    'billing.view': 'View billing information',
    'billing.purchase': 'Purchase a plan',
    'billing.renew': 'Renew a subscription',
    'billing.invoice': 'View and download invoices',
  }),
  ...customer('support', {
    'support.view': 'View support tickets',
    'support.create': 'Open a support ticket',
    'support.reply': 'Reply to a support ticket',
  }),
  ...customer('activity', {
    'activity.view': 'View account activity',
  }),
  ...customer('settings', {
    'settings.view': 'View account settings',
    'settings.update': 'Update account settings',
  }),

  ...admin('admin', {
    'admin.customers': 'View and manage customers',
    'admin.customers.suspend': 'Suspend or terminate a customer',
    'admin.hosting_services': 'Manage customer hosting services',
    'admin.plans': 'Manage hosting plans',
    'admin.providers': 'Manage provider accounts',
    'admin.providers.credentials': 'Add, view metadata for, and rotate provider credentials',
    'admin.resource_mapping': 'Map provider resources to customers',
    'admin.permissions': 'Manage roles and permissions',
    'admin.billing': 'Manage billing, invoices and refunds',
    'admin.logs': 'View activity logs',
    'admin.security_logs': 'View security logs',
    'admin.system_settings': 'Manage system settings',
    'admin.impersonate': 'View the portal as a customer',
    'admin.search': 'Use global search',
  }),
  // Staff ticket handling is a separate set from the customer-facing support
  // keys above. They are namespaced `admin.*` so a staff role can never be
  // composed from customer-realm keys by mistake — seeding filters by realm, so
  // that mistake shows up as a role silently missing permissions.
  ...admin('support', {
    'admin.support.view': 'View all support tickets',
    'admin.support.reply': 'Reply to support tickets',
    'admin.support.assign': 'Assign support tickets',
    'admin.support.close': 'Close or reopen support tickets',
  }),
  ...admin('billing', {
    'admin.billing.refund': 'Issue a refund',
  }),
];

/** All keys, for validating that every route declares a real permission. */
export const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

/**
 * Default role composition. SUPER_ADMIN is deliberately absent: it is granted
 * every ADMIN-realm permission at seed time, so a newly added admin permission
 * is never silently withheld from the role that is supposed to have everything.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: PERMISSIONS.filter(
    (p) =>
      p.realm === Realm.ADMIN &&
      // An operational admin manages the business but not the keys to it.
      !['admin.permissions', 'admin.providers.credentials', 'admin.impersonate'].includes(p.key),
  ).map((p) => p.key),

  SUPPORT_STAFF: [
    'admin.customers',
    'admin.hosting_services',
    'admin.logs',
    'admin.search',
    'admin.support.view',
    'admin.support.reply',
    'admin.support.assign',
    'admin.support.close',
  ],

  CUSTOMER: PERMISSIONS.filter((p) => p.realm === Realm.CUSTOMER).map((p) => p.key),
};
