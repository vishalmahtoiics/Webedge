import { describe, expect, it } from 'vitest';
import { keysOf, listOf, mapResource } from './resource-mapping';

/**
 * Reading payloads whose shape nobody published.
 *
 * Every test here is really the same test: **when the mapping does not
 * recognise something, it must say so rather than fill it in.** That is the
 * "no invented data" rule at its sharpest — this module's whole job is
 * guessing, so it is the one place where a confident wrong answer is easiest to
 * produce and hardest to notice.
 *
 * A wrong name on an infrastructure page is not cosmetic. It is what a staff
 * member reads before attaching a resource to a customer, and attaching the
 * wrong domain to the wrong customer is a tenancy breach that no amount of
 * `TenantScope` further down can undo.
 */

describe('finding the list', () => {
  it.each([
    ['a bare array', [{ domain: 'a.test' }]],
    ['a data wrapper', { data: [{ domain: 'a.test' }] }],
    ['an items wrapper', { items: [{ domain: 'a.test' }] }],
    ['a results wrapper', { results: [{ domain: 'a.test' }] }],
  ])('reads %s', (_name, body) => {
    expect(listOf(body)).toHaveLength(1);
  });

  /**
   * The distinction the page depends on. An empty account and an unreadable
   * response must not render the same, because one is the customer's truth and
   * the other is our bug.
   */
  it('separates an empty list from an unreadable answer', () => {
    expect(listOf([])).toEqual([]);
    expect(listOf({ data: [] })).toEqual([]);

    expect(listOf({ total: 4 })).toBeNull();
    expect(listOf('not json')).toBeNull();
    expect(listOf(null)).toBeNull();
  });
});

describe('mapping a record', () => {
  it('reads the obvious shape', () => {
    const mapped = mapResource({
      id: 'dom_123',
      domain: 'example.test',
      status: 'active',
      expires_at: '2027-03-14T00:00:00Z',
    });

    expect(mapped?.providerKey).toBe('dom_123');
    expect(mapped?.name).toBe('example.test');
    expect(mapped?.status).toBe('active');
    expect(mapped?.expiresAt?.toISOString()).toBe('2027-03-14T00:00:00.000Z');
    expect(mapped?.mapped).toEqual(['id', 'name', 'status', 'expiresAt']);
  });

  /** `expires_at`, `expiresAt` and `ExpiresAt` are one candidate, not three. */
  it.each([
    ['snake case', { id: '1', domain_name: 'a.test', expires_at: '2027-01-01' }],
    ['camel case', { id: '1', domainName: 'a.test', expiresAt: '2027-01-01' }],
    ['pascal case', { Id: '1', DomainName: 'a.test', ExpiresAt: '2027-01-01' }],
    ['kebab case', { id: '1', 'domain-name': 'a.test', 'expires-at': '2027-01-01' }],
  ])('does not care about %s', (_name, row) => {
    const mapped = mapResource(row);
    expect(mapped?.name).toBe('a.test');
    expect(mapped?.expiresAt).not.toBeNull();
  });

  /**
   * The core of it. A payload using words this module has never seen yields a
   * row with a null name — not the id wearing a name's clothes.
   */
  it('leaves a field null when no candidate matches', () => {
    const mapped = mapResource({ id: 'abc', libelle: 'example.test', etat: 'actif' });

    expect(mapped?.providerKey).toBe('abc');
    expect(mapped?.name).toBeNull();
    expect(mapped?.status).toBeNull();
    expect(mapped?.mapped).toEqual(['id']);
    // The payload is kept, so a corrected mapping can be applied to it later
    // without re-syncing every account.
    expect(mapped?.raw).toEqual({ id: 'abc', libelle: 'example.test', etat: 'actif' });
  });

  /** An empty string is not a value. Storing it renders a blank row that reads as our bug. */
  it('treats an empty string as absent', () => {
    const mapped = mapResource({ id: 'abc', domain: '   ', status: '' });

    expect(mapped?.name).toBeNull();
    expect(mapped?.status).toBeNull();
    expect(mapped?.mapped).toEqual(['id']);
  });

  /**
   * A row that can be tracked across syncs, or no row. A key that changes every
   * sync duplicates the inventory on every run, which is worse than a gap.
   */
  it('refuses a record with nothing stable to key on', () => {
    expect(mapResource({ colour: 'blue', size: 3 })).toBeNull();
    expect(mapResource({})).toBeNull();
    expect(mapResource(null)).toBeNull();
    expect(mapResource('a string')).toBeNull();
    expect(mapResource([1, 2])).toBeNull();
  });

  it('falls back to the name when the provider gave no id', () => {
    const mapped = mapResource({ domain: 'example.test', status: 'active' });

    expect(mapped?.providerKey).toBe('example.test');
    expect(mapped?.mapped).not.toContain('id');
  });
});

/**
 * The hosting payload a live account actually sent. Every key here was
 * observed, not supposed:
 *
 *   client_id, created_at, domain, horizons_uuid, is_enabled, order_id,
 *   parent_domain, root_directory, username, vhost_type, website_type
 *
 * It has no `id`, no `status` and no expiry, which broke three assumptions at
 * once.
 */
describe('a real hosting website payload', () => {
  const website = {
    client_id: 4210,
    created_at: '2025-11-02T09:12:00Z',
    domain: 'speflsc.in',
    horizons_uuid: null,
    is_enabled: true,
    order_id: 99100,
    parent_domain: null,
    root_directory: '/public_html',
    username: 'u634179083',
    vhost_type: 'main',
    website_type: 'hosting',
  };

  /**
   * The one that would have been silently catastrophic. There is no `id`, and
   * `client_id` is the same on every website of an account — matching it would
   * collapse nine websites into one row, each sync overwriting the last, and
   * the inventory would look plausible while being wrong.
   */
  it('keys on the domain, never on client_id or order_id', () => {
    const mapped = mapResource(website);

    expect(mapped?.providerKey).toBe('speflsc.in');
    expect(mapped?.providerKey).not.toBe('4210');
    expect(mapped?.providerKey).not.toBe('99100');
    expect(mapped?.mapped).not.toContain('id');
  });

  it('keeps two websites of one account distinct', () => {
    const a = mapResource({ ...website, domain: 'speflsc.in' });
    const b = mapResource({ ...website, domain: 'craftygiftz.com' });

    expect(a?.providerKey).not.toBe(b?.providerKey);
  });

  /** No status word, so the status comes from the flag the payload does carry. */
  it('reads is_enabled as the status', () => {
    expect(mapResource(website)?.status).toBe('enabled');
    expect(mapResource({ ...website, is_enabled: false })?.status).toBe('disabled');
  });

  it('resolves a name and a status, and no expiry', () => {
    const mapped = mapResource(website);

    expect(mapped?.name).toBe('speflsc.in');
    expect(mapped?.mapped).toContain('status');
    // Websites do not expire; the subscription paying for one does.
    expect(mapped?.expiresAt).toBeNull();
  });
});

describe('a status that is a flag rather than a word', () => {
  /** `false` is a value. A disabled site must read disabled, not unknown. */
  it('does not treat false as absent', () => {
    expect(mapResource({ domain: 'a.test', is_enabled: false })?.status).toBe('disabled');
    expect(mapResource({ domain: 'a.test', is_active: false })?.status).toBe('inactive');
    expect(mapResource({ domain: 'a.test', is_suspended: true })?.status).toBe('suspended');
  });

  /** The provider's own vocabulary is richer than a boolean, so it wins. */
  it('prefers a stated status over a flag', () => {
    const mapped = mapResource({ domain: 'a.test', status: 'running', is_enabled: false });
    expect(mapped?.status).toBe('running');
  });

  /** A flag that is not a boolean is not a status. */
  it.each([
    ['a string', 'yes'],
    ['a number', 1],
    ['null', null],
  ])('ignores is_enabled when it is %s', (_name, value) => {
    expect(mapResource({ domain: 'a.test', is_enabled: value })?.status).toBeNull();
  });
});

describe('reading dates', () => {
  it.each([
    ['an ISO timestamp', '2027-03-14T00:00:00Z', '2027-03-14T00:00:00.000Z'],
    ['a plain date', '2027-03-14', '2027-03-14T00:00:00.000Z'],
    ['unix seconds', 1_800_000_000, '2027-01-15T08:00:00.000Z'],
    ['unix milliseconds', 1_800_000_000_000, '2027-01-15T08:00:00.000Z'],
  ])('reads %s', (_name, value, expected) => {
    const mapped = mapResource({ id: '1', expires_at: value });
    expect(mapped?.expiresAt?.toISOString()).toBe(expected);
  });

  /**
   * An unreadable date is no date. A domain shown as expiring today because a
   * string would not parse is how someone renews the wrong thing in a panic —
   * or worse, does not renew the right one.
   */
  it.each([
    ['nonsense', 'next tuesday'],
    ['an empty string', ''],
    ['a boolean', true],
    ['an object', { year: 2027 }],
  ])('refuses to invent a date from %s', (_name, value) => {
    const mapped = mapResource({ id: '1', expires_at: value });
    expect(mapped?.expiresAt).toBeNull();
    expect(mapped?.mapped).not.toContain('expiresAt');
  });
});

describe('reporting what the payload used', () => {
  /** So a mapping that found nothing can be corrected without guessing twice. */
  it('lists the keys actually present', () => {
    expect(keysOf([{ b: 1, a: 2 }, { c: 3 }])).toEqual(['a', 'b', 'c']);
  });

  it('ignores anything that is not a record', () => {
    expect(keysOf(['x', 5, null, { a: 1 }])).toEqual(['a']);
  });
});
