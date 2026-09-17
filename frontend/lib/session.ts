import 'server-only';
import { cookies } from 'next/headers';

/**
 * Session tokens live in httpOnly cookies set by this app's own route handlers,
 * never in localStorage and never in a variable browser JavaScript can read
 * (blueprint §22). The browser talks to Next.js; Next.js talks to the API. A
 * stored XSS on a portal page therefore cannot exfiltrate a session.
 *
 * Customer and staff cookies have distinct names so the two realms cannot
 * collide in one browser profile — signing into the admin portal must never
 * silently adopt a customer session, or the reverse.
 */
export type Realm = 'customer' | 'admin';

const NAMES: Record<Realm, { access: string; refresh: string }> = {
  customer: { access: 'we_c_at', refresh: 'we_c_rt' },
  admin: { access: 'we_a_at', refresh: 'we_a_rt' },
};

const isProduction = process.env.NODE_ENV === 'production';

/**
 * `secure` is required for the __Host- prefix and for any cookie worth trusting,
 * but it breaks plain-HTTP local development, so it follows the environment.
 * `sameSite: 'lax'` keeps the cookie off cross-site POSTs while still surviving
 * top-level navigation back into the portal.
 */
const baseCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
} as const;

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
};

export async function setSession(realm: Realm, tokens: SessionTokens): Promise<void> {
  const jar = await cookies();
  const names = NAMES[realm];

  // The access cookie deliberately has no maxAge: it is a session cookie, and
  // the refresh cookie is what survives a browser restart.
  jar.set(names.access, tokens.accessToken, baseCookieOptions);

  jar.set(names.refresh, tokens.refreshToken, {
    ...baseCookieOptions,
    // Staff sessions are far shorter-lived than customer sessions, matching the
    // backend's own refresh-token lifetimes.
    maxAge: realm === 'admin' ? 12 * 60 * 60 : 30 * 24 * 60 * 60,
  });
}

export async function getSession(realm: Realm): Promise<Partial<SessionTokens>> {
  const jar = await cookies();
  const names = NAMES[realm];
  return {
    accessToken: jar.get(names.access)?.value,
    refreshToken: jar.get(names.refresh)?.value,
  };
}

export async function clearSession(realm: Realm): Promise<void> {
  const jar = await cookies();
  const names = NAMES[realm];
  jar.delete(names.access);
  jar.delete(names.refresh);
}

export const cookieNames = NAMES;
