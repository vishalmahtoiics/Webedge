import { Algorithm, hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

/**
 * Argon2id hashing, in one place.
 *
 * Four files used to import an argon2 library directly and restate the cost
 * parameters, which is why swapping the implementation was a four-file change.
 * It is one now.
 *
 * **Why `@node-rs/argon2` and not `argon2`.** The `argon2` package ships a
 * prebuilt binary for linux-x64 that requires GLIBC_2.34. Enterprise Linux 8 —
 * which most shared and managed hosting still runs — has glibc 2.28, so the
 * prebuild fails to load, `node-gyp-build` falls back to compiling from source,
 * and node-gyp's bundled gyp needs Python 3.8+ for its walrus operators while
 * EL8 ships Python 3.6.8. The install dies with a `SyntaxError` inside a Python
 * file, which points at none of that.
 *
 * `@node-rs/argon2` is built with napi-rs and its linux-x64-gnu binary needs
 * only GLIBC_2.14, so it loads on EL8 and never invokes a compiler. Installing
 * WebEdge therefore needs no build toolchain, no Python and no C++ compiler on
 * the target machine.
 *
 * **The hashes are the same.** Both produce and accept the standard PHC string
 * `$argon2id$v=19$m=…,t=…,p=…$salt$hash`. Verified in both directions against
 * the old library, and against a real `doveadm pw -t` — mailbox hashes written
 * here are read by Dovecot, so a format change would surface as every customer
 * being unable to collect their mail. Existing stored hashes keep verifying and
 * nobody has to reset a password.
 */

export type Argon2Cost = {
  /** KiB of memory. The parameter that actually costs an attacker. */
  memoryCost: number;
  timeCost: number;
  parallelism: number;
};

/**
 * Account passwords — staff and customer sign-in.
 *
 * OWASP's floor, not a target. Benchmark on production hardware and raise until
 * a hash takes roughly 0.5s there.
 */
export const ACCOUNT_COST: Argon2Cost = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/**
 * Mailbox passwords — higher, because these face the open internet on port 993
 * where every IMAP client in the world may try them and WebEdge applies no rate
 * limit of its own.
 */
export const MAILBOX_COST: Argon2Cost = {
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

export function hashPassword(plain: string, cost: Argon2Cost = ACCOUNT_COST): Promise<string> {
  return argon2Hash(plain, { ...cost, algorithm: Algorithm.Argon2id });
}

/**
 * Verifies a password against a stored hash.
 *
 * A malformed hash is a failed verification, not an exception. The caller's
 * question is "is this password right", and for an unreadable hash the answer is
 * no — letting it throw turns a failed login into a 500.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, plain);
  } catch {
    return false;
  }
}

/** Whether a stored hash was made with weaker parameters than are current. */
export function needsRehash(hash: string, cost: Argon2Cost): boolean {
  const params = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hash);
  if (!params) return true;

  return (
    Number(params[1]) < cost.memoryCost ||
    Number(params[2]) < cost.timeCost ||
    Number(params[3]) !== cost.parallelism
  );
}
