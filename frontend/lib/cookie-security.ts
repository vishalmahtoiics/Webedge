/**
 * Whether the session cookies for a request carry the `Secure` attribute.
 *
 * `Secure` is what makes a session cookie worth trusting: without it the
 * refresh token crosses the wire in clear text and anyone on the network path
 * owns the session. So it is on for every request that arrived over TLS, with
 * no setting to get wrong and no way to switch it off.
 *
 * It is decided per request rather than from `NODE_ENV`, which is what this
 * used to read and is the defect. `NODE_ENV=production` means "an optimised
 * build"; the build tooling sets it whether or not there is a certificate in
 * front of the app. It says nothing about the scheme the browser used, and
 * tying a cookie's `Secure` flag to it is a guess that is wrong for every
 * plain-HTTP deployment.
 *
 * Being wrong that way is expensive out of proportion to the mistake, because
 * of how a browser refuses a `Secure` cookie over plain HTTP: it discards it
 * *silently*. No error, no failed request, nothing in the response that the
 * person filling in the form could see. The sign-in POST returns 200, the
 * redirect to the dashboard runs, the dashboard finds no session and sends the
 * browser back to the login page. The symptom is "my password does not work"
 * while the password is perfectly correct — and the proof that it is correct,
 * the API accepting it, sits on the far side of the layer that failed. Found
 * by driving a real browser at the running app: over a loopback origin both
 * cookies were stored, and over a plain-HTTP hostname the jar came back empty
 * with every response still a 200.
 *
 * Setting `Secure` on a plain-HTTP response is therefore not the cautious
 * choice; it is strictly the worse one. The cookie the browser throws away
 * protects nothing at all, and it costs the sign-in. What protects a
 * plain-HTTP deployment is a certificate, not a flag the browser ignored.
 *
 * `x-forwarded-proto` is what a reverse proxy — Traefik, nginx, whatever
 * terminates TLS — states about the scheme the browser actually used, and it
 * is the only party that knows: the application itself is always spoken to
 * over plain HTTP from behind the proxy. Directly exposed with no proxy there
 * is no header to read, and the fallback is the old `NODE_ENV` reading, which
 * is both the conservative answer and unchanged behaviour for anyone that
 * setup was already working for.
 *
 * A forged header downgrades only the forger's own session — the value is read
 * from a request to decide the cookies on that request's response, so nobody
 * can use it to strip `Secure` from anyone else's.
 */
export function secureForProto(
  forwardedProto: string | null | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  // A proxy chain sets this to a comma-separated list, oldest first; the
  // browser-facing hop is the leftmost. Reading the last would report the hop
  // into this application, which is plain HTTP by design and always would be.
  const first = forwardedProto?.split(',')[0]?.trim().toLowerCase();

  if (first === 'https') return true;
  if (first === 'http') return false;

  return nodeEnv === 'production';
}
