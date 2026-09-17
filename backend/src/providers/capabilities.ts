/**
 * What each provider product family can actually do.
 *
 * Blueprint §23: the portal can only automate what the provider API genuinely
 * exposes, and a WebEdge screen does not conjure a capability into existence.
 * The UI renders from resolved capabilities so a missing feature shows an honest
 * unavailable state rather than a control that fails when clicked.
 *
 * Derived from Hostinger's published endpoint index and the generated
 * @hostinger/sdk models (September 2026). **Endpoint existence is well
 * established; runtime behaviour is not.** Re-verify against a live staging
 * account before relying on any of it, and correct this file rather than working
 * around it.
 */

export type Capability =
  // Websites
  | 'websites.list'
  | 'websites.create'
  | 'websites.delete'
  | 'websites.suspend'
  // Files
  | 'files.list'
  | 'files.read'
  | 'files.upload'
  | 'files.write'
  | 'files.rename'
  | 'files.move'
  | 'files.delete'
  | 'files.mkdir'
  // Databases
  | 'databases.list'
  | 'databases.create'
  | 'databases.delete'
  | 'databases.changePassword'
  // DNS
  | 'dns.read'
  | 'dns.write'
  | 'dns.validate'
  | 'dns.snapshots'
  // Metrics
  | 'metrics.disk'
  | 'metrics.diskPerWebsite'
  | 'metrics.cpuMemory'
  | 'metrics.cpuMemoryPerWebsite'
  // Other
  | 'ssl.read'
  | 'ssl.issue'
  | 'backups.list'
  | 'backups.restore'
  | 'php.settings'
  | 'cron.manage'
  | 'sftp.details'
  | 'security.phpVersion'
  | 'security.nodeVulnerabilities'
  | 'security.wordpressVulnerabilities'
  | 'security.malwareScan';

export type ProductFamily = 'agency-hosting' | 'shared' | 'unknown';

/**
 * How a capability is delivered. `sftp` matters because those operations need
 * per-website credentials the mapping wizard must collect — they are not
 * available from the API token alone.
 */
export type CapabilityMechanism = 'api' | 'sftp' | 'none';

export type CapabilityResolution = {
  available: boolean;
  mechanism: CapabilityMechanism;
  /** Shown to staff in the admin capability matrix. Never shown to customers. */
  note?: string;
};

const UNAVAILABLE: CapabilityResolution = { available: false, mechanism: 'none' };
const VIA_API: CapabilityResolution = { available: true, mechanism: 'api' };

/**
 * Agency Hosting. Its isolation unit is the website — each gets its own system
 * user — which is why it is the family that can host multiple customers safely.
 * It has no file browse or read endpoints at all, so the file manager is SFTP
 * end to end, which is in fact simpler than splitting across two mechanisms.
 */
const AGENCY: Partial<Record<Capability, CapabilityResolution>> = {
  'websites.list': VIA_API,
  'websites.create': VIA_API,
  'websites.delete': { available: true, mechanism: 'api', note: 'Asynchronous; poll for completion' },
  'websites.suspend': {
    ...UNAVAILABLE,
    note: 'No endpoint. Suspension is a WebEdge panel lock plus an admin runbook.',
  },

  // No file endpoints in this family at all — not even listing.
  'files.list': { available: true, mechanism: 'sftp', note: 'SFTP only; no file API in this family' },
  'files.read': { available: true, mechanism: 'sftp' },
  'files.upload': { available: true, mechanism: 'sftp', note: 'API upload URLs exist but leak provider hostnames' },
  'files.write': { available: true, mechanism: 'sftp' },
  'files.rename': { available: true, mechanism: 'sftp' },
  'files.move': { available: true, mechanism: 'sftp' },
  'files.delete': { available: true, mechanism: 'sftp' },
  'files.mkdir': { available: true, mechanism: 'sftp' },

  'databases.list': VIA_API,
  'databases.create': VIA_API,
  'databases.delete': VIA_API,
  'databases.changePassword': {
    ...UNAVAILABLE,
    note: 'No endpoint in this family. Only recreating the database user changes credentials, which changes the username too.',
  },

  'dns.read': VIA_API,
  'dns.write': VIA_API,
  'dns.validate': VIA_API,
  'dns.snapshots': VIA_API,

  'metrics.disk': { available: true, mechanism: 'api', note: 'Order-level only' },
  'metrics.diskPerWebsite': {
    ...UNAVAILABLE,
    note: 'Disk metrics are order-level. Per-website storage has no source; show it against the plan.',
  },
  'metrics.cpuMemory': VIA_API,
  'metrics.cpuMemoryPerWebsite': VIA_API,

  'ssl.read': { available: true, mechanism: 'api', note: 'Certificate names and expiry come with website details' },
  'ssl.issue': { ...UNAVAILABLE, note: 'No endpoint; issuance is provider-automatic' },

  'backups.list': { ...UNAVAILABLE, note: 'No backup endpoints outside VPS. Offer a restore request instead.' },
  'backups.restore': UNAVAILABLE,

  'php.settings': VIA_API,
  'cron.manage': { available: true, mechanism: 'api', note: 'Website-scoped' },
  'sftp.details': { available: true, mechanism: 'api', note: 'Host, username and port; password must be set out of band' },

  'security.phpVersion': VIA_API,
  'security.nodeVulnerabilities': { ...UNAVAILABLE, note: 'Shared/cloud only' },
  'security.wordpressVulnerabilities': {
    ...UNAVAILABLE,
    note: 'No endpoint in any family. Show available WordPress updates instead.',
  },
  'security.malwareScan': { ...UNAVAILABLE, note: 'No endpoint in any family' },
};

/**
 * Shared, cloud and business hosting. Databases and cron are scoped to the
 * hosting *account*, not the website, so two customers under one account are not
 * isolated from each other. Usable for a single customer per account; placement
 * must never co-locate two customers here.
 */
const SHARED: Partial<Record<Capability, CapabilityResolution>> = {
  'websites.list': VIA_API,
  'websites.create': VIA_API,
  'websites.delete': VIA_API,
  'websites.suspend': { ...UNAVAILABLE, note: 'No endpoint' },

  'files.list': VIA_API,
  'files.read': VIA_API,
  'files.upload': { available: true, mechanism: 'sftp', note: 'API upload URLs leak provider hostnames' },
  'files.write': { available: true, mechanism: 'sftp', note: 'No write endpoint exists' },
  'files.rename': { available: true, mechanism: 'sftp' },
  'files.move': { available: true, mechanism: 'sftp' },
  'files.delete': { available: true, mechanism: 'sftp' },
  'files.mkdir': { available: true, mechanism: 'sftp' },

  'databases.list': { available: true, mechanism: 'api', note: 'Account-scoped, not website-scoped' },
  'databases.create': { available: true, mechanism: 'api', note: 'Account-scoped' },
  'databases.delete': { available: true, mechanism: 'api', note: 'Account-scoped' },
  'databases.changePassword': VIA_API,

  'dns.read': VIA_API,
  'dns.write': VIA_API,
  'dns.validate': VIA_API,
  'dns.snapshots': VIA_API,

  'metrics.disk': { ...UNAVAILABLE, note: 'No usage metrics in this family' },
  'metrics.diskPerWebsite': UNAVAILABLE,
  'metrics.cpuMemory': UNAVAILABLE,
  'metrics.cpuMemoryPerWebsite': UNAVAILABLE,

  'ssl.read': { ...UNAVAILABLE, note: 'No endpoint; use provider-agnostic TLS inspection' },
  'ssl.issue': UNAVAILABLE,

  'backups.list': UNAVAILABLE,
  'backups.restore': UNAVAILABLE,

  'php.settings': VIA_API,
  'cron.manage': {
    available: true,
    mechanism: 'api',
    note: 'ACCOUNT-scoped. A cron job here can read any website under the same account.',
  },
  'sftp.details': { ...UNAVAILABLE, note: 'Not exposed; collect during resource mapping' },

  'security.phpVersion': VIA_API,
  'security.nodeVulnerabilities': VIA_API,
  'security.wordpressVulnerabilities': { ...UNAVAILABLE, note: 'No endpoint in any family' },
  'security.malwareScan': { ...UNAVAILABLE, note: 'No endpoint in any family' },
};

const MATRIX: Record<ProductFamily, Partial<Record<Capability, CapabilityResolution>>> = {
  'agency-hosting': AGENCY,
  shared: SHARED,
  // An unmapped account claims nothing. Better a feature wrongly hidden than a
  // control that fails when a customer clicks it.
  unknown: {},
};

export function resolveCapability(
  family: ProductFamily,
  capability: Capability,
): CapabilityResolution {
  return MATRIX[family][capability] ?? UNAVAILABLE;
}

export function isCapable(family: ProductFamily, capability: Capability): boolean {
  return resolveCapability(family, capability).available;
}

/** The full resolved set, for the admin capability matrix and the customer capabilities endpoint. */
export function resolveAll(family: ProductFamily): Record<string, CapabilityResolution> {
  const out: Record<string, CapabilityResolution> = {};
  for (const capability of Object.keys(MATRIX['agency-hosting']) as Capability[]) {
    out[capability] = resolveCapability(family, capability);
  }
  return out;
}

/**
 * Whether a family isolates websites from one another well enough to host
 * different customers side by side.
 *
 * Agency Hosting gives each website its own system user; shared hosting scopes
 * databases and cron to the account, so one customer's cron job can read
 * another's files. Placement must refuse to co-locate customers where this is
 * false.
 *
 * Still pending live filesystem confirmation on a staging account — the API
 * paths prove the API is website-scoped, not that the filesystem is.
 */
export function isolatesWebsites(family: ProductFamily): boolean {
  return family === 'agency-hosting';
}
