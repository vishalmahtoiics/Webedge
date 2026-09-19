import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { secureForProto } from '../../frontend/lib/cookie-security';

/**
 * The portal's session cookies must carry `Secure` on every request that
 * reached the browser over TLS, and must not carry it on one that did not.
 *
 * The second half is the part that is easy to get wrong while believing you
 * are being careful. A browser discards a `Secure` cookie set over plain HTTP
 * without saying so: the sign-in POST returns 200, the redirect to the
 * dashboard runs, the dashboard finds no session and bounces back to the login
 * page. Nothing anywhere reports a failure, and the person sees only that
 * their correct password did not work. Setting the flag there buys no
 * security — the cookie is gone — and costs the sign-in.
 *
 * This is a backend test file because this is where the repository's test
 * runner lives, in the same way `build-output.spec.ts` asserts over the root
 * `.dockerignore`. The rule belongs to the portal.
 */
describe('portal session cookie security', () => {
  it('sets Secure when the browser reached the proxy over TLS', () => {
    expect(secureForProto('https', 'production')).toBe(true);
    expect(secureForProto('https', 'development')).toBe(true);
    expect(secureForProto('HTTPS', undefined)).toBe(true);
  });

  it('omits Secure when the browser reached the proxy over plain HTTP', () => {
    // Not a downgrade: the browser would refuse the cookie either way. This is
    // the difference between a sign-in that works over HTTP and one that fails
    // with no error to show for it.
    expect(secureForProto('http', 'production')).toBe(false);
    expect(secureForProto('http', 'development')).toBe(false);
  });

  it('reads the browser-facing hop of a proxy chain, not the hop into this app', () => {
    // A chain appends, oldest first. The last entry is the hop into this
    // application, which is plain HTTP by design and always will be, so
    // reading it would strip Secure from every TLS deployment behind two
    // proxies.
    expect(secureForProto('https, http')).toBe(true);
    expect(secureForProto('https,http')).toBe(true);
    expect(secureForProto('http, http')).toBe(false);
  });

  it('falls back to NODE_ENV when no proxy states a scheme', () => {
    // Directly exposed, no proxy: nothing knows the scheme, so the
    // conservative reading stands and behaviour is unchanged for anyone this
    // was already working for.
    expect(secureForProto(undefined, 'production')).toBe(true);
    expect(secureForProto(null, 'production')).toBe(true);
    expect(secureForProto('', 'production')).toBe(true);
    expect(secureForProto(undefined, 'development')).toBe(false);
  });

  it('treats an unrecognised scheme as no statement at all', () => {
    expect(secureForProto('wss', 'production')).toBe(true);
    expect(secureForProto('wss', 'development')).toBe(false);
  });

  it('decides the flag per request, never once per process', () => {
    // A module-level decision is a cookie flag that cannot differ between two
    // requests the same process serves, which is how one deployment ends up
    // working on the origin it was built for and nowhere else. The whole point
    // of reading a header is lost if the answer is cached at import.
    const session = readFileSync(
      join(__dirname, '..', '..', 'frontend', 'lib', 'session.ts'),
      'utf8',
    );

    // Asserted over the code rather than the comments: the flag has to be
    // computed inside something that takes the request's headers, so a later
    // edit that hoists it back to module scope fails here.
    const withoutComments = session.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

    expect(withoutComments).toMatch(/secure:\s*secureForProto\(/);
    expect(withoutComments).toContain("get('x-forwarded-proto')");
    expect(
      withoutComments,
      'the Secure flag must be computed per request, not at module load',
    ).toMatch(/async function baseCookieOptions\(\)[\s\S]*secure:\s*secureForProto\(/);
    expect(
      withoutComments,
      'session.ts must not decide Secure from NODE_ENV; that is the defect this fixed',
    ).not.toContain('NODE_ENV');
  });
});
