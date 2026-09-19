/**
 * Reading a provider payload whose shape is not published.
 *
 * The provider documents no response bodies — its own generated types say
 * `response: any; // Response structure will depend on the API` — so the keys
 * carrying a domain name, a status or an expiry date are not knowable in
 * advance. This module resolves them by trying candidate key names.
 *
 * **That is a guess, and it is treated as one.** Three rules follow from it:
 *
 *  - A field with no matching key stays `null`. It is never filled with the
 *    resource's own id, an empty string, or a date of today. A visibly missing
 *    name sends someone to look; a plausible wrong one does not.
 *  - Which fields were resolved is recorded alongside the row, so a half-read
 *    payload is visible rather than looking complete.
 *  - The payload is stored as received, so a mapping corrected next week is
 *    applied to data already fetched instead of requiring every account to be
 *    re-synced.
 *
 * Correct the candidate lists here when a real payload disagrees, and record
 * what the provider actually sent in `docs/provider-api.md`.
 */

export type MappedResource = {
  providerKey: string;
  name: string | null;
  status: string | null;
  expiresAt: Date | null;
  /** Target fields a key was found for. */
  mapped: string[];
  raw: Record<string, unknown>;
};

/**
 * Candidate keys per target field, most likely first.
 *
 * Matched case-insensitively and ignoring `_`, so `expires_at`, `expiresAt` and
 * `ExpiresAt` are one candidate rather than three.
 */
const CANDIDATES: Record<'name' | 'status' | 'expiresAt' | 'id', string[]> = {
  name: ['domain', 'name', 'domainname', 'hostname', 'host', 'title', 'label'],
  status: ['status', 'state', 'lifecyclestatus'],
  expiresAt: ['expiresat', 'expirationdate', 'expires', 'expiredate', 'validuntil', 'renewalDate'],
  id: ['id', 'uuid', 'resourceid', 'websiteid', 'domainid', 'virtualmachineid', 'subscriptionid'],
};

const normalise = (key: string): string => key.replace(/[_\-\s]/g, '').toLowerCase();

/** The first candidate present with a usable value, or undefined. */
function pick(row: Record<string, unknown>, candidates: string[]): unknown {
  const byNormalised = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) byNormalised.set(normalise(key), value);

  for (const candidate of candidates) {
    const value = byNormalised.get(normalise(candidate));
    // An empty string is not a value. A provider that sends `"name": ""` has
    // told us nothing, and storing it would render as a blank row that looks
    // like a bug in WebEdge rather than a gap in the payload.
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return undefined;
}

const asText = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
};

/** Parses a date without inventing one. Anything unreadable is null. */
function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  // Unix seconds or milliseconds. Distinguished by magnitude: anything below
  // 10^11 as a number is seconds, because milliseconds passed that in 1973.
  if (typeof value === 'number') {
    const ms = value < 100_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

/**
 * Turns one provider record into something storable.
 *
 * `providerKey` is the identity a re-sync matches on, so it must be stable:
 * the provider's own id if there is one, else the name. A record with neither
 * cannot be tracked across syncs and is rejected rather than stored under a
 * key that would change — a row that duplicates on every sync is worse than
 * one that was never created.
 */
export function mapResource(row: unknown): MappedResource | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;

  const mapped: string[] = [];

  const id = asText(pick(record, CANDIDATES.id));
  const name = asText(pick(record, CANDIDATES.name));
  const status = asText(pick(record, CANDIDATES.status));
  const expiresAt = asDate(pick(record, CANDIDATES.expiresAt));

  if (id !== null) mapped.push('id');
  if (name !== null) mapped.push('name');
  if (status !== null) mapped.push('status');
  if (expiresAt !== null) mapped.push('expiresAt');

  const providerKey = id ?? name;
  if (providerKey === null) return null;

  return { providerKey, name, status, expiresAt, mapped, raw: record };
}

/**
 * Finds the list inside a response without assuming the wrapper.
 *
 * Returns null rather than an empty array when nothing list-shaped is found,
 * for the same reason a count is null rather than zero: "no resources" and "we
 * could not read the answer" must not look identical.
 */
export function listOf(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    for (const key of ['data', 'items', 'results', 'list']) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return null;
}

/** The keys a payload actually used, for when the mapping found nothing. */
export function keysOf(rows: unknown[]): string[] {
  const keys = new Set<string>();
  for (const row of rows.slice(0, 5)) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      for (const key of Object.keys(row)) keys.add(key);
    }
  }
  return [...keys].sort();
}
