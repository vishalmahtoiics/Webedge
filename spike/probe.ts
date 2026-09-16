/**
 * Hostinger capability probe — M0 spike deliverables 2 and 4 (spec §5.3).
 *
 * READ-ONLY. This script never issues a write. Write probing needs the owner's
 * explicit go-ahead and is a manual runbook step (see isolation-test.md),
 * because there is no provider sandbox: every call touches a real account.
 */

const BASE = process.env.HOSTINGER_API_BASE_URL ?? 'https://developers.hostinger.com';
const TOKEN = process.env.HOSTINGER_STAGING_API_TOKEN;

const DELAY_MS = 900; // stay well under any per-minute limit; repeated 429s can block the IP (§5.2)

type Probe = {
  id: string;
  path: string;
  question: string;
};

type Result = {
  id: string;
  path: string;
  question: string;
  status: number | 'error';
  ms: number;
  rateLimitHeaders: Record<string, string>;
  shape?: unknown;
  error?: string;
};

/** Keys whose values are leak-register-sensitive (§5.6) and never written to a fixture. */
const REDACT_KEYS = new Set([
  'username', 'ipv4', 'ip', 'hostname', 'host', 'fqdn', 'auth_key', 'rest_auth_key',
  'url', 'password', 'token', 'secret', 'auth_code', 'email', 'address',
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string): Promise<{ status: number; ms: number; headers: Headers; body: unknown }> {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  });
  const ms = Date.now() - started;
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON response kept as text */
  }
  return { status: res.status, ms, headers: res.headers, body };
}

function rateLimitHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (/ratelimit|retry-after/i.test(key)) out[key] = value;
  });
  return out;
}

/**
 * Reduces a response to its structure: key names and value types, with sensitive
 * values redacted. The spike needs to know which fields exist and are populated,
 * not what the owner's real account contains.
 */
function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 6) return '<max depth>';
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shapeOf(value[0], depth + 1), `<${value.length} items>`];
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? `<redacted ${typeof v}>` : shapeOf(v, depth + 1);
    }
    return out;
  }
  // Primitives are reported as type plus a populated/empty flag. Whether a documented
  // field is ever actually populated is one of the things the spike exists to answer.
  if (typeof value === 'string') return value === '' ? '<empty string>' : '<string>';
  return `<${typeof value}>`;
}

/** Pulls the first value for `key` out of a list-shaped response, whatever the envelope. */
function firstValue(body: unknown, key: string): string | undefined {
  const items = Array.isArray(body)
    ? body
    : typeof body === 'object' && body !== null && Array.isArray((body as { data?: unknown[] }).data)
      ? (body as { data: unknown[] }).data
      : [];
  for (const item of items) {
    if (typeof item === 'object' && item !== null) {
      const v = (item as Record<string, unknown>)[key];
      if (typeof v === 'string' && v !== '') return v;
      if (typeof v === 'number') return String(v);
    }
  }
  return undefined;
}

/** Inventory probes. These run first and supply the identifiers the detail probes need. */
const INVENTORY: Probe[] = [
  { id: 'hosting-websites', path: '/api/hosting/v1/websites', question: 'Are there shared/cloud websites on this account?' },
  { id: 'hosting-orders', path: '/api/hosting/v1/orders', question: 'Which shared/cloud hosting orders exist?' },
  { id: 'agency-orders', path: '/api/agency-hosting/v1/orders', question: 'Is Agency Hosting available? ADR-001 depends on this.' },
  { id: 'agency-websites', path: '/api/agency-hosting/v1/websites', question: 'Which Agency websites exist?' },
  { id: 'domains-portfolio', path: '/api/domains/v1/portfolio', question: 'Which domains are held?' },
  { id: 'mail-orders', path: '/api/mail/v1/orders', question: 'Which mail orders exist? Needed for ADR-002.' },
  { id: 'billing-subscriptions', path: '/api/billing/v1/subscriptions', question: 'What is actually owned, and on what terms?' },
];

async function main(): Promise<void> {
  if (!TOKEN) {
    console.error('HOSTINGER_STAGING_API_TOKEN is not set. See .env.example.');
    console.error('Use a staging token. There is no provider sandbox — this reads a real account.');
    process.exit(1);
  }

  const results: Result[] = [];
  const discovered: Record<string, string | undefined> = {};

  // Discovered identifiers are substituted out of recorded paths. Without this the
  // fixture would leak the account username and real domains via the URLs themselves,
  // which is exactly what the leak register exists to prevent.
  const redactPath = (path: string): string => {
    let out = path;
    for (const [name, value] of Object.entries(discovered)) {
      if (value) out = out.split(value).join(`{${name}}`);
    }
    return out;
  };

  const run = async (probe: Probe): Promise<unknown> => {
    await sleep(DELAY_MS);
    try {
      const { status, ms, headers, body } = await call(probe.path);
      results.push({
        ...probe,
        status,
        ms,
        rateLimitHeaders: rateLimitHeaders(headers),
        shape: status < 400 ? shapeOf(body) : undefined,
        error: status >= 400 ? `HTTP ${status}` : undefined,
      });
      console.log(`  ${status} ${String(ms).padStart(5)}ms  ${probe.path}`);
      return status < 400 ? body : undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ ...probe, status: 'error', ms: 0, rateLimitHeaders: {}, error: message });
      console.log(`  ERROR        ${probe.path} — ${message}`);
      return undefined;
    }
  };

  console.log(`\nInventory (${INVENTORY.length} read-only probes)\n`);
  for (const probe of INVENTORY) {
    const body = await run(probe);
    if (probe.id === 'agency-websites') discovered.agencyWebsiteUid = firstValue(body, 'uid');
    if (probe.id === 'agency-orders') discovered.agencyOrderId = firstValue(body, 'id');
    if (probe.id === 'hosting-websites') {
      discovered.hostingUsername = firstValue(body, 'username');
      discovered.hostingDomain = firstValue(body, 'domain');
    }
    if (probe.id === 'domains-portfolio') discovered.domain = firstValue(body, 'domain');
    if (probe.id === 'mail-orders') discovered.mailOrderId = firstValue(body, 'id');
  }

  // Detail probes. Each is skipped when inventory found no identifier for it, so the
  // script degrades gracefully on an account that holds only some product families.
  const { agencyWebsiteUid, agencyOrderId, hostingUsername, hostingDomain, domain, mailOrderId } = discovered;
  const details: Probe[] = [
    agencyWebsiteUid && {
      id: 'agency-website-detail',
      path: `/api/agency-hosting/v1/websites/${agencyWebsiteUid}`,
      question: 'THE key probe. Does it return user.username (per-website OS user), remote_access.sftp, ssl, preview_domain?',
    },
    agencyWebsiteUid && {
      id: 'agency-website-databases',
      path: `/api/agency-hosting/v1/websites/${agencyWebsiteUid}/databases`,
      question: 'Are databases scoped per website on Agency?',
    },
    agencyWebsiteUid && {
      id: 'agency-website-cron',
      path: `/api/agency-hosting/v1/websites/${agencyWebsiteUid}/cron-jobs`,
      question: 'Are cron jobs scoped per website on Agency?',
    },
    agencyOrderId && {
      id: 'agency-disk-usage',
      path: `/api/agency-hosting/v1/orders/${agencyOrderId}/disk-usage-metrics`,
      question: 'Is disk usage really order-level only, with no per-website breakdown?',
    },
    agencyOrderId && {
      id: 'agency-resource-usage',
      path: `/api/agency-hosting/v1/orders/${agencyOrderId}/resource-usage-metrics`,
      question: 'Does CPU/memory really break down per website?',
    },
    hostingUsername && {
      id: 'hosting-account-databases',
      path: `/api/hosting/v1/accounts/${hostingUsername}/databases`,
      question: 'Confirms shared hosting scopes databases to the ACCOUNT, not the website.',
    },
    hostingUsername && {
      id: 'hosting-account-cron',
      path: `/api/hosting/v1/accounts/${hostingUsername}/cron-jobs`,
      question: 'Confirms shared hosting scopes cron to the ACCOUNT. This is the §5.4 isolation failure.',
    },
    hostingUsername && hostingDomain && {
      id: 'hosting-files-list',
      path: `/api/hosting/v1/accounts/${hostingUsername}/domains/${hostingDomain}/files?path=/`,
      question: 'Does shared hosting file listing work, and what does it return?',
    },
    domain && {
      id: 'dns-zone',
      path: `/api/dns/v1/zones/${domain}`,
      question: 'What does a DNS zone look like? Drives the record-level UX.',
    },
    mailOrderId && {
      id: 'mail-plan',
      path: `/api/mail/v1/orders/${mailOrderId}/plan`,
      question: 'Confirms quota is a PLAN property, not per mailbox (blocks §8.4 quota controls).',
    },
    mailOrderId && {
      id: 'mail-mailboxes',
      path: `/api/mail/v1/orders/${mailOrderId}/mailboxes`,
      question: 'Is mailbox usage (storage_used/quota, synced_at) actually populated?',
    },
  ].filter((p): p is Probe => Boolean(p));

  console.log(`\nDetail (${details.length} probes; skipped where inventory found no identifier)\n`);
  for (const probe of details) await run(probe);

  const observedRateLimits = results.flatMap((r) => Object.entries(r.rateLimitHeaders));
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    note: 'Read-only probe. Values are redacted; only structure and population are recorded.',
    discovered: Object.fromEntries(
      Object.entries(discovered).map(([k, v]) => [k, v ? '<found>' : '<none>']),
    ),
    rateLimitHeadersObserved: observedRateLimits.length
      ? Object.fromEntries(observedRateLimits)
      : 'NONE — the real global limit could not be read from headers. Measure it manually before sizing sync intervals.',
    results: results.map((r) => ({ ...r, path: redactPath(r.path) })),
  };

  const out = new URL('./fixtures/probe-report.json', import.meta.url);
  await (await import('node:fs/promises')).mkdir(new URL('./fixtures/', import.meta.url), { recursive: true });
  await (await import('node:fs/promises')).writeFile(out, `${JSON.stringify(report, null, 2)}\n`);

  const ok = results.filter((r) => typeof r.status === 'number' && r.status < 400).length;
  console.log(`\n${ok}/${results.length} probes succeeded. Report: spike/fixtures/probe-report.json`);
  console.log('Review it for leaked values before committing, then update docs/PROVIDER-INTEGRATION.md.\n');
}

await main();
