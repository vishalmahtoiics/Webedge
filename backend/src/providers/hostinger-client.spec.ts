import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOSTINGER_BASE_URL, PROBES, probe } from './hostinger.client';

/**
 * The provider HTTP call.
 *
 * One property here matters more than the rest: **a token must never appear in
 * anything this module returns.** The outcome of a probe is written to the
 * database, rendered on a staff page and recorded in the audit trail, so a
 * token that leaked into an error message would be copied into all three — and
 * the trail is append-only, so it could not be taken back out.
 *
 * The rest is about not inventing an answer. An unrecognised body shape yields
 * a null count rather than zero, because zero reads as "you have nothing" and
 * is indistinguishable from "we could not tell".
 */

const TOKEN = 'super-secret-token-value-9f3a2b';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs fetch with a fixed response, and records what was sent. */
function stubFetch(response: Partial<Response> & { textBody?: string }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      text: () => Promise.resolve(response.textBody ?? '[]'),
    } as Response);
  });
  return calls;
}

describe('sending the request', () => {
  it('calls the documented base URL with a bearer token', async () => {
    const calls = stubFetch({ ok: true, status: 200, textBody: '[]' });

    await probe(TOKEN, 'domains', '/api/domains/v1/portfolio');

    expect(calls[0]?.url).toBe(`${HOSTINGER_BASE_URL}/api/domains/v1/portfolio`);
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  /** Every probe is a GET, which is what makes running this against a live account safe. */
  it('never uses a method that could change anything', async () => {
    const calls = stubFetch({ ok: true, status: 200, textBody: '[]' });

    for (const { area, path } of PROBES) {
      await probe(TOKEN, area, path);
    }

    expect(calls).toHaveLength(PROBES.length);
    for (const call of calls) expect(call.init.method).toBe('GET');
  });
});

describe('keeping the token out of the result', () => {
  it.each([
    ['unauthorised', 401, 'invalid token'],
    ['forbidden', 403, 'insufficient scope'],
    ['missing', 404, 'not found'],
    ['rate limited', 429, 'slow down'],
    ['server error', 500, 'boom'],
  ])('does not echo the token on a %s response', async (_name, status, body) => {
    stubFetch({ ok: false, status, textBody: body });

    const outcome = await probe(TOKEN, 'domains', '/api/domains/v1/portfolio');

    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
  });

  /**
   * The case that would actually leak: a fetch rejection can quote the whole
   * request, and the request carries the Authorization header.
   */
  it('does not echo the token when the request itself fails', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.reject(new Error(`request to ${HOSTINGER_BASE_URL} failed, headers: Bearer ${TOKEN}`)),
    );

    const outcome = await probe(TOKEN, 'domains', '/api/domains/v1/portfolio');

    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
  });

  it('does not echo the token when the provider times out', async () => {
    vi.stubGlobal('fetch', () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      return Promise.reject(error);
    });

    const outcome = await probe(TOKEN, 'domains', '/api/domains/v1/portfolio');

    expect(outcome.status).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
  });
});

describe('reading the answer', () => {
  it.each([
    ['a bare array', '[{"a":1},{"a":2}]', 2],
    ['a data wrapper', '{"data":[{"a":1}]}', 1],
    ['an items wrapper', '{"items":[]}', 0],
  ])('counts %s', async (_name, body, expected) => {
    stubFetch({ ok: true, status: 200, textBody: body });

    const outcome = await probe(TOKEN, 'domains', '/api/domains/v1/portfolio');

    expect(outcome.ok).toBe(true);
    expect(outcome.count).toBe(expected);
  });

  /**
   * The distinction the whole "no invented data" rule rests on. A shape this
   * code does not recognise is unknown, not empty — rendering it as "0 records"
   * would tell an operator their account is empty on the strength of a response
   * nobody has read.
   */
  it.each([
    ['an unrecognised object', '{"total":7}'],
    ['a non-JSON body', 'service unavailable'],
    ['an empty body', ''],
  ])('reports an unknown count as unknown for %s', async (_name, body) => {
    stubFetch({ ok: true, status: 200, textBody: body });

    const outcome = await probe(TOKEN, 'domains', '/api/domains/v1/portfolio');

    expect(outcome.count).toBeNull();
    expect(outcome.count).not.toBe(0);
  });

  /** A 404 is recorded, not swallowed: a wrong path must not read as an empty account. */
  it('records a missing endpoint rather than treating it as empty', async () => {
    stubFetch({ ok: false, status: 404, textBody: 'no such route' });

    const outcome = await probe(TOKEN, 'websites', '/api/hosting/v1/websites');

    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe(404);
    expect(outcome.count).toBeNull();
    expect(outcome.detail).toMatch(/not on the account|path wrong/i);
  });
});
