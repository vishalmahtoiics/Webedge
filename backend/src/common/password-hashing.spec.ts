import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_COST, MAILBOX_COST, hashPassword, needsRehash, verifyPassword,
} from './password-hashing';

/**
 * Argon2id hashing, and the compatibility that makes swapping the library safe.
 *
 * The implementation moved from `argon2` to `@node-rs/argon2` because the former
 * ships a prebuilt binary requiring GLIBC_2.34 and most managed hosting runs
 * Enterprise Linux 8 with glibc 2.28 — so it fell back to compiling, and
 * node-gyp's Python needs 3.8+ where EL8 has 3.6.8.
 *
 * A hashing library is not a thing to swap on the strength of a version number.
 * Two properties have to hold, and both are pinned here:
 *
 *  - Hashes already in the database must still verify, or every customer is
 *    locked out and every password needs resetting.
 *  - Hashes written here must still be readable by Dovecot, which authenticates
 *    mailboxes directly against them.
 */

const PASSWORD = 'correct horse battery staple';

/**
 * Produced by `doveadm pw -s ARGON2ID` — a completely separate implementation,
 * not by any library this project depends on. If our verification accepts this,
 * it accepts the standard rather than merely its own output, which is the real
 * property: the hashes in a deployed database were written by the old library
 * and have to keep working.
 */
const FOREIGN_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$Eu1RTzX2omuhteNFLm91BQ$d1u99BNpzCsJarN0jL5I5YyH5OCVMqfzNOfO1YZSvsM';

/** Written by the `argon2` npm package this replaced, at the account cost. */
const LEGACY_ACCOUNT_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ozVW3meAtY9Iv65Bnz+9pg$xD18marN1WIJ9vt9WZepfrjzl7L7j2c8fypGTUBejyc';

describe('hashing', () => {
  it('produces a standard PHC argon2id string', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  });

  it('uses a fresh salt every time', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
  });

  it('writes the mailbox cost when asked for it', async () => {
    const hash = await hashPassword(PASSWORD, MAILBOX_COST);
    expect(hash).toContain('m=65536,t=3,p=1');
  });

  /** Mailbox passwords face the open internet, so they cost more to guess. */
  it('costs more for a mailbox than for an account', () => {
    expect(MAILBOX_COST.memoryCost).toBeGreaterThan(ACCOUNT_COST.memoryCost);
    expect(MAILBOX_COST.timeCost).toBeGreaterThanOrEqual(ACCOUNT_COST.timeCost);
  });
});

describe('verifying', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, 'not the password')).toBe(false);
  });

  /**
   * The property that makes the library swap safe. Without it, every stored
   * password stops working the moment this ships.
   */
  it('accepts a hash written by a different argon2 implementation', async () => {
    expect(await verifyPassword(FOREIGN_HASH, PASSWORD)).toBe(true);
    expect(await verifyPassword(FOREIGN_HASH, 'not the password')).toBe(false);
  });

  it('accepts a hash written by the library this replaced', async () => {
    expect(await verifyPassword(LEGACY_ACCOUNT_HASH, PASSWORD)).toBe(true);
    expect(await verifyPassword(LEGACY_ACCOUNT_HASH, 'not the password')).toBe(false);
  });

  /**
   * Throwing here turns a failed login into a 500, and a 500 on a login form
   * tells an attacker they found something.
   */
  it('treats an unreadable hash as a failed verification, not an error', async () => {
    for (const hash of ['', 'not a hash', '$argon2id$garbage', '$2b$10$bcryptstyle']) {
      await expect(verifyPassword(hash, PASSWORD), hash).resolves.toBe(false);
    }
  });

  it('handles passwords with characters that break naive quoting', async () => {
    for (const password of [
      'quote\'and"double',
      'back\\slash and `backtick`',
      'सॉफ़्टवेयर 🔐',
      'a'.repeat(200),
    ]) {
      const hash = await hashPassword(password);
      expect(await verifyPassword(hash, password), password.slice(0, 20)).toBe(true);
    }
  });
});

describe('deciding when to rehash', () => {
  it('leaves a current hash alone', async () => {
    expect(needsRehash(await hashPassword(PASSWORD), ACCOUNT_COST)).toBe(false);
  });

  it('flags a hash made with less memory or fewer passes', () => {
    expect(needsRehash('$argon2id$v=19$m=4096,t=2,p=1$c2FsdA$aGFzaA', ACCOUNT_COST)).toBe(true);
    expect(needsRehash('$argon2id$v=19$m=19456,t=1,p=1$c2FsdA$aGFzaA', ACCOUNT_COST)).toBe(true);
  });

  /** An account hash is below the mailbox cost, and should be raised on use. */
  it('flags an account-cost hash when measured against the mailbox cost', () => {
    expect(needsRehash(LEGACY_ACCOUNT_HASH, MAILBOX_COST)).toBe(true);
    expect(needsRehash(LEGACY_ACCOUNT_HASH, ACCOUNT_COST)).toBe(false);
  });

  it('flags anything it cannot read, so it gets replaced rather than trusted', () => {
    expect(needsRehash('nonsense', ACCOUNT_COST)).toBe(true);
    expect(needsRehash('$2b$10$bcryptstyle', ACCOUNT_COST)).toBe(true);
  });
});
