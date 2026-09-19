import 'server-only';
import { cookies, headers } from 'next/headers';
import { secureForProto } from './cookie-security';

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

/**
 * `secure` is decided from the scheme the browser actually used, which only
 * the proxy in front of this application knows — see `cookie-security.ts` for
 * why it is read per request and not from `NODE_ENV`. `sameSite: 'lax'` keeps
 * the cookie off cross-site POSTs while still surviving top-level navigation
 * back into the portal.
 */
async function baseCookieOptions() {
  const requestHeaders = await headers();
  return {
    httpOnly: true,
    secure: secureForProto(requestHeaders.get('x-forwarded-proto')),
    sameSite: 'lax',
    path: '/',
  } as const;
}

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
};

export async function setSession(realm: Realm, tokens: SessionTokens): Promise<void> {
  const jar = await cookies();
  const names = NAMES[realm];
  const options = await baseCookieOptions();

  // The access cookie deliberately has no maxAge: it is a session cookie, and
  // the refresh cookie is what survives a browser restart.
  jar.set(names.access, tokens.accessToken, options);

  jar.set(names.refresh, tokens.refreshToken, {
    ...options,
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
