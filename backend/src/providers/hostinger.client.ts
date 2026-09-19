import { AppError } from '../common/errors';

/**
 * The HTTP call to the upstream provider.
 *
 * **What is established and what is not.** The base URL, the bearer scheme and
 * the `/api/{product}/v{n}/` path shape come from the provider's published API
 * reference. The exact response bodies are not pinned here, and nothing in this
 * file assumes one: a probe records the status code and, for a failure, the
 * text the provider sent back. That way a path this file has wrong shows up as
 * a 404 on the Infrastructure page rather than as a silently empty list, which
 * is the failure mode worth avoiding — an empty list looks like "you have no
 * websites" and is indistinguishable from "we asked the wrong question".
 *
 * Nothing here writes. Every method is a GET, which is what makes it safe to
 * run against a live account: the standing rule is that no provider resource
 * outside production is written to unless its name starts with `wetest-`, and a
 * read cannot breach it.
 *
 * The token never appears in an error. A thrown message carries the status and
 * the path, never the header — an exception that reaches a log with a bearer
 * token in it is a credential in the log.
 */

/** Fixed, and deliberately not configurable: a base URL read from the database would be an SSRF. */
export const HOSTINGER_BASE_URL = 'https://developers.hostinger.com';

/** Long enough for a slow list, short enough that a page does not hang on it. */
const TIMEOUT_MS = 15_000;

export type ProbeOutcome = {
  /** The product area probed, in WebEdge's terms rather than the provider's. */
  area: string;
  path: string;
  status: number | null;
  ok: boolean;
  /** How many records came back, when the body was a countable list. */
  count: number | null;
  /** Present on failure. Never contains the token. */
  detail?: string;
};

/**
 * Read-only endpoints, one per product area.
 *
 * **Verified, not guessed.** Taken from the provider's own MCP package
 * (`hostinger-api-mcp@1.61.1`, read from npm), which carries the method and
 * path of every endpoint it exposes. Three of the four paths first written here
 * from the published reference were right; the fourth was not, and that is the
 * reason this list cites a source. `/api/dns/v1/zones` does not exist — every
 * DNS read is `/api/dns/v1/zones/{domain}` — so a DNS probe would have returned
 * 404 forever and reported "this token cannot reach DNS", which is a false
 * statement about the customer's account rather than a broken feature.
 *
 * DNS is therefore absent here rather than approximated. It is reachable once a
 * domain is known, and the place to check it is against a domain from the
 * portfolio, not from this list.
 *
 * Ordered cheapest and most universal first. A token that reaches some areas
 * and not others is the normal case, not a fault: a token inherits the
 * permissions of the user who created it, and an account only answers for
 * products it actually has.
 */
export const PROBES: Array<{ area: string; path: string }> = [
  { area: 'domains', path: '/api/domains/v1/portfolio' },
  // Two hosting products with separate paths, not one path with a flag. An
  // agency account answers on `/agency-hosting/` and 404s on `/hosting/`, and
  // the reverse — so probing both is how the account tells us which it is,
  // rather than us believing the product family somebody typed into the form.
  { area: 'websites', path: '/api/hosting/v1/websites' },
  { area: 'agency websites', path: '/api/agency-hosting/v1/websites' },
  { area: 'vps', path: '/api/vps/v1/virtual-machines' },
  // What the account actually bought, which is what decides whether an empty
  // websites list means "none yet" or "no hosting on this plan".
  { area: 'billing', path: '/api/billing/v1/subscriptions' },
];

/** Counts a list response without assuming its shape. */
function countOf(body: unknown): number | null {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === 'object') {
    for (const key of ['data', 'items', 'results']) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value.length;
    }
  }
  return null;
}

/** A GET against the provider. Returns the outcome rather than throwing for HTTP errors. */
export async function probe(token: string, area: string, path: string): Promise<ProbeOutcome> {
  const url = `${HOSTINGER_BASE_URL}${path}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        // Identifies WebEdge to the provider without naming a customer.
        'User-Agent': 'WebEdge/1.0',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      return {
        area,
        path,
        status: response.status,
        ok: false,
        count: null,
        // The provider's own words, truncated. Its error text is the most
        // useful thing on the page when a token has the wrong scope, and it
        // does not contain the token — we sent that, it did not.
        detail: explain(response.status, text),
      };
    }

    return { area, path, status: response.status, ok: true, count: countOf(body) };
  } catch (error) {
    return {
      area,
      path,
      status: null,
      ok: false,
      count: null,
      detail: networkDetail(error),
    };
  }
}

/** Turns a status into something an operator can act on. */
function explain(status: number, text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 300);

  switch (status) {
    case 401:
      return 'The provider rejected the token. It is wrong, revoked, or expired.';
    case 403:
      // Deliberately not "the token is valid but lacks scope". A 403 can come
      // from something between here and the provider — an egress policy on this
      // server answers 403 too — and asserting the token is good when it may
      // never have left the building sends the operator to the wrong place.
      // The sender's own words are the evidence; this line does not add to them.
      return `Refused (403). This is usually a token whose permissions do not cover this product — a token inherits them from the user who created it — but an outbound proxy can also answer 403.${trimmed ? ` Answer: ${trimmed}` : ''}`;
    case 404:
      return `No such endpoint on the provider. Either this product is not on the account, or WebEdge has the path wrong.${trimmed ? ` Provider said: ${trimmed}` : ''}`;
    case 429:
      return 'Rate limited by the provider. Wait and try again.';
    default:
      return `The provider answered ${status}.${trimmed ? ` ${trimmed}` : ''}`;
  }
}

function networkDetail(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `The provider did not answer within ${TIMEOUT_MS / 1000}s.`;
  }
  // Deliberately not the raw message: a fetch failure can quote the request,
  // and the request carries the Authorization header.
  return 'Could not reach the provider. Check outbound network access from this server.';
}

/** Thrown when a caller needs a hard failure rather than an outcome. */
export function unavailable(): AppError {
  return new AppError(
    'PROVIDER_UNAVAILABLE',
    "We couldn't reach the hosting provider. Try again in a few minutes.",
  );
}
