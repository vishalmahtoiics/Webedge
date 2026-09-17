import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CredentialCipherService } from './credential-cipher.service';
import { resetConfigCache } from '../config/env';

const TOKEN = 'hostinger_pat_9f3c1d7ba24e58c0d1e6a7b4';

describe('CredentialCipherService', () => {
  let cipher: CredentialCipherService;

  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.JWT_ACCESS_SECRET = 'x'.repeat(40);
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    process.env.CREDENTIAL_ENCRYPTION_KEY_VERSION = 'v1';
    process.env.COOKIE_SECURE = 'false';
    resetConfigCache();
    cipher = new CredentialCipherService();
  });

  it('round-trips a token', () => {
    const encrypted = cipher.encrypt(TOKEN);
    expect(cipher.decrypt(encrypted)).toBe(TOKEN);
  });

  it('never stores the plaintext in any stored field', () => {
    const encrypted = cipher.encrypt(TOKEN);
    const serialized = JSON.stringify(encrypted);

    expect(serialized).not.toContain(TOKEN);
    // A partial leak is still a leak: check a distinctive interior slice, not
    // just the whole token.
    expect(serialized).not.toContain(TOKEN.slice(0, 20));
    expect(encrypted.ciphertext).not.toContain('hostinger');
  });

  it('exposes only the last four characters for display', () => {
    const encrypted = cipher.encrypt(TOKEN);
    expect(encrypted.lastFour).toBe('a7b4');
    expect(encrypted.lastFour.length).toBe(4);
  });

  /**
   * Reusing an IV under one key breaks GCM catastrophically — it leaks the
   * authentication key itself, not merely the plaintext. Encrypting the same
   * value twice must therefore produce different ciphertext.
   */
  it('uses a fresh IV for every encryption', () => {
    const a = cipher.encrypt(TOKEN);
    const b = cipher.encrypt(TOKEN);

    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(cipher.decrypt(a)).toBe(TOKEN);
    expect(cipher.decrypt(b)).toBe(TOKEN);
  });

  it('refuses tampered ciphertext rather than returning garbage', () => {
    const encrypted = cipher.encrypt(TOKEN);
    const raw = Buffer.from(encrypted.ciphertext, 'base64');
    raw[0] = raw[0]! ^ 0xff;

    expect(() =>
      cipher.decrypt({ ...encrypted, ciphertext: raw.toString('base64') }),
    ).toThrow();
  });

  it('refuses a tampered auth tag', () => {
    const encrypted = cipher.encrypt(TOKEN);
    const tag = Buffer.from(encrypted.authTag, 'base64');
    tag[0] = tag[0]! ^ 0xff;

    expect(() => cipher.decrypt({ ...encrypted, authTag: tag.toString('base64') })).toThrow();
  });

  it('refuses a swapped IV, which would otherwise decrypt to the wrong token', () => {
    const a = cipher.encrypt(TOKEN);
    const b = cipher.encrypt('a-different-token-entirely');

    expect(() => cipher.decrypt({ ...a, iv: b.iv })).toThrow();
  });

  it('fails loudly when the key version is unknown', () => {
    const encrypted = cipher.encrypt(TOKEN);
    expect(() => cipher.decrypt({ ...encrypted, keyVersion: 'v-retired' })).toThrow(
      /No encryption key for version/,
    );
  });

  it('stamps every record with the current key version, so rotation is possible', () => {
    expect(cipher.encrypt(TOKEN).keyVersion).toBe('v1');
  });

  it('refuses to encrypt an empty credential', () => {
    expect(() => cipher.encrypt('')).toThrow(/empty credential/);
  });

  it('rejects a short encryption key at construction', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(16).toString('hex');
    resetConfigCache();
    // Config validation catches the wrong length before the service does.
    expect(() => new CredentialCipherService()).toThrow();

    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    resetConfigCache();
  });

  describe('matches', () => {
    it('compares equal strings', () => {
      expect(CredentialCipherService.matches('abc123', 'abc123')).toBe(true);
    });

    it('rejects different strings and different lengths without throwing', () => {
      expect(CredentialCipherService.matches('abc123', 'abc124')).toBe(false);
      expect(CredentialCipherService.matches('abc', 'abcdef')).toBe(false);
    });
  });
});
