import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ARGON2_OPTIONS, DOVECOT_SCHEME, hashMailboxPassword, needsRehash, stripScheme,
  verifyMailboxPassword,
} from './mail-password';

const run = promisify(execFile);

/**
 * Mailbox passwords, checked against a real Dovecot.
 *
 * The claim this file exists to prove is that a hash produced here verifies in
 * Dovecot — not that it looks like one. A unit test comparing string shapes
 * would pass against a format Dovecot rejects, and the failure would surface as
 * every customer being unable to collect their mail.
 *
 * Needs `dovecot-core` installed for `doveadm`. The suite says so and skips
 * rather than passing quietly, because a green run that proved nothing is worse
 * than a visible gap.
 */
describe('mailbox passwords', () => {
  const PASSWORD = 'correct horse battery staple';
  let doveadm = false;

  beforeAll(async () => {
    try {
      await run('doveadm', ['pw', '-l']);
      doveadm = true;
    } catch {
      doveadm = false;
    }
  });

  /** `doveadm pw -t` exits non-zero on a mismatch, which is the whole signal. */
  const dovecotAccepts = async (stored: string, password: string): Promise<boolean> => {
    try {
      const { stdout } = await run('doveadm', ['pw', '-t', stored, '-p', password]);
      return stdout.includes('verified');
    } catch {
      return false;
    }
  };

  describe('format', () => {
    it('carries the scheme Dovecot reads', async () => {
      const stored = await hashMailboxPassword(PASSWORD);
      expect(stored.startsWith(`{${DOVECOT_SCHEME}}`)).toBe(true);
      expect(stripScheme(stored)).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
    });

    it('uses a fresh salt every time', async () => {
      const [a, b] = await Promise.all([
        hashMailboxPassword(PASSWORD),
        hashMailboxPassword(PASSWORD),
      ]);
      expect(a).not.toBe(b);
    });

    /**
     * A mailbox password faces the open internet on port 993, where every IMAP
     * client in the world may try it and WebEdge applies no rate limit of its
     * own.
     */
    it('refuses a short password', async () => {
      await expect(hashMailboxPassword('short')).rejects.toThrow(/at least 12/);
    });

    it('refuses to read a value written under another scheme', () => {
      expect(stripScheme('{SHA512-CRYPT}$6$abc$def')).toBeNull();
      expect(stripScheme('no scheme at all')).toBeNull();
    });
  });

  describe('verification here', () => {
    it('accepts the right password and rejects the wrong one', async () => {
      const stored = await hashMailboxPassword(PASSWORD);
      expect(await verifyMailboxPassword(stored, PASSWORD)).toBe(true);
      expect(await verifyMailboxPassword(stored, 'not the password')).toBe(false);
    });

    /** The caller's question is "is this password right"; for an unreadable hash the answer is no. */
    it('treats a malformed stored value as a failed verification, not an error', async () => {
      expect(await verifyMailboxPassword('{ARGON2ID}garbage', PASSWORD)).toBe(false);
      expect(await verifyMailboxPassword('', PASSWORD)).toBe(false);
    });
  });

  describe('verification by Dovecot itself', () => {
    it('is being checked against a real doveadm', () => {
      expect(
        doveadm,
        'doveadm is not installed, so nothing here proved Dovecot accepts our hashes',
      ).toBe(true);
    });

    it('accepts a hash WebEdge produced', async () => {
      const stored = await hashMailboxPassword(PASSWORD);
      expect(await dovecotAccepts(stored, PASSWORD)).toBe(true);
    });

    it('rejects the wrong password against that same hash', async () => {
      const stored = await hashMailboxPassword(PASSWORD);
      expect(await dovecotAccepts(stored, 'not the password')).toBe(false);
    });

    /**
     * Passwords go through argument vectors and config files on their way into
     * a mail server. Anything that survives a round trip here survives those.
     */
    it('handles passwords with characters that break naive quoting', async () => {
      for (const password of [
        "quote'and\"double",
        'spaces and $VARIABLES',
        'back\\slash and `backtick`',
        'unicode: सॉफ़्टवेयर 🔐',
        'semicolon; rm -rf /',
      ]) {
        const stored = await hashMailboxPassword(password);
        expect(await verifyMailboxPassword(stored, password), password).toBe(true);
        expect(await dovecotAccepts(stored, password), password).toBe(true);
      }
    });

    /**
     * Dovecot must not accept a truncated password as the full one. Some older
     * schemes silently ignore everything past the eighth character, which is why
     * this is asserted rather than assumed.
     */
    it('does not accept a truncation of a long password', async () => {
      const long = 'a-very-long-mailbox-password-that-goes-on';
      const stored = await hashMailboxPassword(long);

      expect(await dovecotAccepts(stored, long)).toBe(true);
      expect(await dovecotAccepts(stored, long.slice(0, 8))).toBe(false);
      expect(await dovecotAccepts(stored, long.slice(0, 20))).toBe(false);
    });
  });

  describe('upgrading cost parameters', () => {
    it('leaves a current hash alone', async () => {
      expect(needsRehash(await hashMailboxPassword(PASSWORD))).toBe(false);
    });

    it('flags a hash made with weaker parameters', () => {
      const weaker = `{${DOVECOT_SCHEME}}$argon2id$v=19$m=${
        ARGON2_OPTIONS.memoryCost / 4
      },t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g`;
      expect(needsRehash(weaker)).toBe(true);
    });

    it('flags anything it cannot read, so it gets replaced rather than trusted', () => {
      expect(needsRehash('{SHA512-CRYPT}$6$abc$def')).toBe(true);
      expect(needsRehash('nonsense')).toBe(true);
    });
  });
});
