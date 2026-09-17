import { MAILBOX_COST, hashPassword, needsRehash as costIsBelow, verifyPassword } from '../common/password-hashing';

/**
 * Mailbox passwords, in the form Dovecot verifies.
 *
 * WebEdge hashes with argon2id in this process and stores the result with
 * Dovecot's scheme prefix. Dovecot verifies it directly against its own
 * `{ARGON2ID}` scheme — checked against a real `doveadm pw -t`, not assumed.
 * The hashing itself lives in `common/password-hashing.ts`, which owns the
 * library choice; this file owns the Dovecot format around it.
 *
 * Two things this buys. A plaintext password never crosses a process boundary,
 * so it cannot appear in a process listing, a subprocess argument or a shell
 * history. And nothing here can recover a password: a forgotten mailbox password
 * is reset, never retrieved, which is the same rule as for account passwords.
 *
 * The scheme prefix is part of the stored value on purpose. Dovecot reads it to
 * decide how to verify, which is what allows the parameters below to be raised
 * later — existing hashes keep verifying under whatever they were made with.
 */

/** Dovecot's name for the scheme, written into the stored value. */
export const DOVECOT_SCHEME = 'ARGON2ID';

/**
 * Cost parameters. Higher than the defaults of the argon2 library and in line
 * with OWASP's guidance: 64 MiB, three passes. Mailbox authentication happens on
 * every IMAP connection, so this is the trade-off worth revisiting under load —
 * but the wrong direction to err in is the cheap one.
 */
export const ARGON2_OPTIONS = MAILBOX_COST;

/** `{ARGON2ID}$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>` */
export async function hashMailboxPassword(password: string): Promise<string> {
  if (password.length < 12) {
    // Enforced here as well as at the DTO, because a mailbox password is a
    // credential that faces the open internet on port 993 with no rate limit
    // from our side — every IMAP client in the world may try it.
    throw new Error('A mailbox password must be at least 12 characters.');
  }

  const hash = await hashPassword(password, MAILBOX_COST);
  return `{${DOVECOT_SCHEME}}${hash}`;
}

/**
 * Verifies a stored value.
 *
 * WebEdge does not authenticate IMAP — Dovecot does — so this exists for tests
 * and for confirming a password before a change, not as part of any login path.
 */
export async function verifyMailboxPassword(stored: string, password: string): Promise<boolean> {
  const hash = stripScheme(stored);
  if (!hash) return false;

  // A malformed stored value is a failed verification, not an exception to
  // propagate: the caller's question is "is this password right", and the
  // answer for an unreadable hash is no.
  return verifyPassword(hash, password);
}

/** Removes the `{SCHEME}` prefix, or returns null if it is not one we wrote. */
export function stripScheme(stored: string): string | null {
  const match = /^\{([A-Z0-9-]+)\}(.+)$/s.exec(stored.trim());
  if (!match) return null;
  if (match[1] !== DOVECOT_SCHEME) return null;
  return match[2]!;
}

/**
 * Whether a stored value needs re-hashing because the cost parameters moved.
 *
 * Called when a mailbox authenticates successfully through a path that has the
 * plaintext — a password change — so hashes are upgraded gradually rather than
 * by forcing a reset on everyone.
 */
export function needsRehash(stored: string): boolean {
  const hash = stripScheme(stored);
  if (!hash) return true;

  return costIsBelow(hash, MAILBOX_COST);
}
