import { describe, expect, it } from 'vitest';
import { parse } from 'dotenv';
import {
  checkPassword, describePasswordProblem, generateEncryptionKey, generatePassword,
  generateSigningSecret,
} from './secrets';
import { renderEnvFile } from './env-file';

describe('the encryption key', () => {
  /** Exactly the shape `CREDENTIAL_ENCRYPTION_KEY` is validated against at boot. */
  it('is 32 bytes of hex, which is what the config schema demands', () => {
    const key = generateEncryptionKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is different every time', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateEncryptionKey()));
    expect(keys.size).toBe(50);
  });
});

describe('the signing secret', () => {
  it('clears the 32-character minimum comfortably', () => {
    expect(generateSigningSecret().length).toBeGreaterThanOrEqual(64);
  });

  it('is different every time', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateSigningSecret()));
    expect(secrets.size).toBe(50);
  });
});

describe('a generated password', () => {
  it('is long enough to be worth generating', () => {
    expect(generatePassword().length).toBe(24);
    expect(generatePassword(32).length).toBe(32);
  });

  it('refuses to generate one too short to matter', () => {
    expect(() => generatePassword(8)).toThrow(/at least 12/);
  });

  /**
   * This password gets read off a terminal and typed into a browser. A quote or
   * a backslash in it breaks when pasted into a shell, a connection string or an
   * `.env` file, and the failure lands on whoever received it as "the password
   * doesn't work".
   */
  it('avoids the characters that break when pasted somewhere', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generatePassword()).toMatch(/^[a-zA-Z0-9]+$/);
    }
  });

  /** Read off a screen and typed by hand, so the ambiguous glyphs are out. */
  it('leaves out the characters people misread', () => {
    const sample = Array.from({ length: 200 }, () => generatePassword()).join('');
    for (const character of ['l', 'I', '1', 'O', '0']) {
      expect(sample, `contains ${character}`).not.toContain(character);
    }
  });

  it('survives being written into the env file', () => {
    const password = generatePassword();
    const file = renderEnvFile([
      { title: 'T', entries: [{ key: 'SEED_ADMIN_PASSWORD', value: password }] },
    ]);
    expect(parse(file).SEED_ADMIN_PASSWORD).toBe(password);
  });

  it('is different every time', () => {
    const passwords = new Set(Array.from({ length: 200 }, () => generatePassword()));
    expect(passwords.size).toBe(200);
  });

  /**
   * `randomBytes[i] % alphabet.length` is not uniform when the alphabet does not
   * divide 256, and biases the first few characters. With 57 symbols and 200
   * samples of 24 characters, a biased generator shows up as a visibly uneven
   * spread; this checks every symbol appears and none dominates.
   */
  it('spreads across the alphabet rather than favouring the start of it', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i += 1) {
      for (const character of generatePassword()) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }

    const frequencies = [...counts.values()];
    const expected = (400 * 24) / 57;

    expect(counts.size, 'every symbol should appear at least once').toBe(57);
    expect(Math.max(...frequencies)).toBeLessThan(expected * 1.6);
    expect(Math.min(...frequencies)).toBeGreaterThan(expected * 0.4);
  });
});

describe('checking a password someone chose', () => {
  it('accepts a reasonable one', () => {
    expect(checkPassword('correct horse battery staple')).toBeNull();
    expect(checkPassword(generatePassword())).toBeNull();
  });

  it('refuses one that is too short', () => {
    expect(checkPassword('short')).toBe('too-short');
    expect(checkPassword('elevenchar1')).toBe('too-short');
    expect(checkPassword('twelvechars1')).toBeNull();
  });

  it('refuses the handful that get typed into a fresh install', () => {
    for (const password of ['password123', 'ChangeMe123', 'webedge123', 'administrator']) {
      expect(checkPassword(password), password).toBe('too-common');
    }
  });

  it('refuses one character repeated', () => {
    expect(checkPassword('aaaaaaaaaaaaaaaa')).toBe('single-character');
  });

  /** Every refusal says what to do, not just that something is wrong. */
  it('explains every problem it can report', () => {
    for (const problem of ['too-short', 'too-common', 'single-character'] as const) {
      const message = describePasswordProblem(problem);
      expect(message.length, problem).toBeGreaterThan(20);
      expect(message.endsWith('.'), problem).toBe(true);
    }
  });
});
