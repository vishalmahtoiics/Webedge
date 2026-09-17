import { randomBytes, randomInt } from 'node:crypto';

/**
 * The keys and passwords the installer generates.
 *
 * Generated rather than asked for. A person invited to invent a 32-byte
 * encryption key types something memorable, and the whole point of
 * `CREDENTIAL_ENCRYPTION_KEY` is that provider tokens stay unreadable when the
 * database is copied.
 *
 * Everything here uses `crypto`'s CSPRNG. `Math.random` is seeded predictably
 * enough that keys generated on a freshly booted VM can be reproduced, which has
 * happened to real products.
 */

/** 32 bytes, hex — the shape `CREDENTIAL_ENCRYPTION_KEY` is validated against. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

/** The JWT signing secret. Base64url so it carries no `.env` quoting problems. */
export function generateSigningSecret(): string {
  return randomBytes(48).toString('base64url');
}

/**
 * A password a person will have to type at least once.
 *
 * Deliberately not the full printable ASCII range. A generated password
 * containing a quote, a backtick or a backslash is one that breaks when pasted
 * into a shell, a connection string or a `.env` file — and the failure lands on
 * whoever received it, days later, as "the password doesn't work". The alphabet
 * below is unambiguous and safe everywhere, and length buys back the entropy:
 * 24 characters from 57 symbols is about 140 bits.
 *
 * `l`, `I`, `1`, `O` and `0` are left out because this gets read off a terminal
 * and typed into a browser.
 */
const SAFE_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePassword(length = 24): string {
  if (length < 12) throw new Error('A generated password must be at least 12 characters.');

  let out = '';
  for (let i = 0; i < length; i += 1) {
    // `randomInt` is uniform. Taking `randomBytes % alphabet.length` is not,
    // and biases the first few characters of the alphabet.
    out += SAFE_ALPHABET[randomInt(SAFE_ALPHABET.length)];
  }
  return out;
}

export type PasswordProblem = 'too-short' | 'too-common' | 'single-character';

/**
 * The rules applied to a password a person chose.
 *
 * Length first, because it is the only property that reliably matters.
 * Composition rules ("one capital, one symbol") push people toward
 * `Password1!` and are not enforced here. The common-password list is short on
 * purpose: it catches the handful that get typed into a fresh install, and
 * pretending a 200-entry list is a real defence would be worse than saying
 * plainly that length is what is being checked.
 */
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  'administrator',
  'changeme',
  'changeme123',
  'letmein',
  'welcome1',
  'webedge',
  'webedge123',
  'admin1234',
  'qwerty123',
  '123456789012',
  // The longer forms, because the advice for a short common password is to
  // change it rather than to pad it — and padding is what people do.
  'password1234',
  'password12345',
  'changeme1234',
  'webedge12345',
  'administrator1',
]);

export function checkPassword(password: string, minimum = 12): PasswordProblem | null {
  // Commonness is checked before length on purpose. Most of these are eleven or
  // twelve characters, so a length-first check tells someone who typed
  // "password123" to make it longer — and "password1234" then passes. Naming the
  // real problem is the only advice that helps.
  if (COMMON.has(password.toLowerCase())) return 'too-common';
  if (password.length < minimum) return 'too-short';
  if (new Set(password).size === 1) return 'single-character';
  return null;
}

export function describePasswordProblem(problem: PasswordProblem, minimum = 12): string {
  switch (problem) {
    case 'too-short':
      return `Use at least ${minimum} characters. Length is what makes a password hard to guess.`;
    case 'too-common':
      return 'That password appears on every list an attacker tries first.';
    case 'single-character':
      return 'That is one character repeated.';
  }
}
