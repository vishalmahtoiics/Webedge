import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../config/env';

/**
 * Encrypts provider API tokens at rest (blueprint §6, §22).
 *
 * AES-256-GCM rather than CBC: GCM authenticates the ciphertext, so a token
 * tampered with in the database fails to decrypt instead of silently producing
 * garbage that gets sent to the provider as a credential.
 *
 * Every record stores the key version that encrypted it, so keys can be rotated
 * with overlap — new writes use the current key while old records stay readable
 * until a background job re-encrypts them. Without versioning, rotating a key
 * means decrypting every credential in one transaction or losing them all.
 */

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
  lastFour: string;
};

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BYTES = 32;

@Injectable()
export class CredentialCipherService {
  private readonly config = loadConfig();

  /**
   * Keys by version. Today this is the single configured key; when rotation
   * lands, retired keys stay here so existing records remain decryptable.
   */
  private readonly keys = new Map<string, Buffer>();

  constructor() {
    const key = Buffer.from(this.config.CREDENTIAL_ENCRYPTION_KEY, 'hex');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `CREDENTIAL_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
      );
    }
    this.keys.set(this.config.CREDENTIAL_ENCRYPTION_KEY_VERSION, key);
  }

  get currentKeyVersion(): string {
    return this.config.CREDENTIAL_ENCRYPTION_KEY_VERSION;
  }

  encrypt(plaintext: string): EncryptedCredential {
    if (!plaintext) throw new Error('Refusing to encrypt an empty credential');

    const keyVersion = this.currentKeyVersion;
    const key = this.keyFor(keyVersion);

    // A fresh random IV per encryption. Reusing an IV under the same key breaks
    // GCM catastrophically — it leaks the authentication key, not just plaintext.
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion,
      // Displayed in the admin UI so staff can tell two credentials apart
      // without ever revealing the token.
      lastFour: plaintext.slice(-4),
    };
  }

  decrypt(record: Pick<EncryptedCredential, 'ciphertext' | 'iv' | 'authTag' | 'keyVersion'>): string {
    const key = this.keyFor(record.keyVersion);

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));

    // Throws if the auth tag does not match, which is the point: a modified
    // ciphertext must fail loudly rather than yield a corrupted token.
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Constant-time comparison for credential material, so verifying a token does
   * not leak its contents through response timing.
   */
  static matches(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  private keyFor(version: string): Buffer {
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(
        `No encryption key for version "${version}". A credential was encrypted with a key ` +
          'that is no longer configured; restore it before decrypting.',
      );
    }
    return key;
  }
}
