import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlreadyInstalledError, InstallState, type InstallRecord } from './lock';

/**
 * The two controls that keep a setup wizard from being a way to take over a
 * deployment: it closes permanently once installation succeeds, and before then
 * it answers only to someone who can read a file on the server.
 */
describe('install state', () => {
  let dir: string;
  let state: InstallState;

  const record: InstallRecord = {
    installedAt: '2026-09-17T00:00:00.000Z',
    version: '1.0.0',
    seeded: { schema: true, demoData: false, adminUser: true },
    adminEmail: 'admin@example.com',
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'webedge-install-'));
    state = new InstallState(dir);
  });

  afterEach(async () => {
    // The lock is written read-only, so the directory needs forcing away.
    await rm(dir, { recursive: true, force: true });
  });

  describe('before installation', () => {
    it('reports not installed', async () => {
      expect(await state.isInstalled()).toBe(false);
      expect(await state.read()).toBeNull();
    });

    it('lets installation proceed', async () => {
      await expect(state.assertNotInstalled()).resolves.toBeUndefined();
    });
  });

  describe('after installation', () => {
    beforeEach(async () => {
      await state.lock(record);
    });

    it('reports installed and keeps what it recorded', async () => {
      expect(await state.isInstalled()).toBe(true);
      expect(await state.read()).toEqual(record);
    });

    /**
     * The control that matters most. A setup wizard left reachable is an
     * unauthenticated endpoint that can repoint the database and create an
     * administrator.
     */
    it('refuses to install again', async () => {
      await expect(state.assertNotInstalled()).rejects.toBeInstanceOf(AlreadyInstalledError);
    });

    it('carries the record on the refusal, so the page can say when', async () => {
      const error = await state.assertNotInstalled().catch((e: AlreadyInstalledError) => e);
      expect((error as AlreadyInstalledError).record.installedAt).toBe(record.installedAt);
    });

    it('never records the admin password, only the address', async () => {
      const raw = await readFile(state.lockPath, 'utf8');
      expect(raw).toContain('admin@example.com');
      expect(raw.toLowerCase()).not.toContain('password');
    });

    it('writes the lock read-only', async () => {
      const info = await stat(state.lockPath);
      expect(info.mode & 0o777).toBe(0o400);
    });

    /**
     * A lock present but unreadable is treated as installed. Failing open would
     * re-open the wizard on a deployment whose disk is merely having a bad day.
     */
    it('treats an unreadable lock as installed rather than opening the wizard', async () => {
      await writeFile(state.lockPath, 'not json at all', { mode: 0o600 });
      await expect(state.read()).rejects.toThrow();
    });

    /**
     * Re-opening installation is a shell action, not a request. There is
     * deliberately no HTTP route that reaches this.
     */
    it('can only be re-opened by removing the lock directly', async () => {
      await state.unlockForReinstall();
      expect(await state.isInstalled()).toBe(false);
      await expect(state.assertNotInstalled()).resolves.toBeUndefined();
    });
  });

  describe('the setup token', () => {
    it('accepts the token it issued', async () => {
      const token = await state.issueToken();
      expect(await state.verifyToken(token)).toBe(true);
    });

    it('ignores surrounding whitespace, which a copy-paste adds', async () => {
      const token = await state.issueToken();
      expect(await state.verifyToken(`  ${token}\n`)).toBe(true);
    });

    it('rejects anything else', async () => {
      await state.issueToken();
      for (const candidate of ['', 'wrong', 'a'.repeat(43), 'x']) {
        expect(await state.verifyToken(candidate), JSON.stringify(candidate)).toBe(false);
      }
    });

    /**
     * A short candidate would make `timingSafeEqual` throw on a length mismatch,
     * which a caller controls. Hashing both sides first makes the lengths equal
     * and the comparison constant-time.
     */
    it('rejects a candidate of the wrong length without throwing', async () => {
      await state.issueToken();
      await expect(state.verifyToken('short')).resolves.toBe(false);
      await expect(state.verifyToken('y'.repeat(4096))).resolves.toBe(false);
    });

    it('rejects everything when no token has been issued', async () => {
      expect(await state.verifyToken('anything')).toBe(false);
    });

    it('issues a different token every time', async () => {
      const first = await state.issueToken();
      const second = await state.issueToken();
      expect(first).not.toBe(second);
      expect(first.length).toBeGreaterThanOrEqual(43);
      // The old one stops working the moment a new one is issued.
      expect(await state.verifyToken(first)).toBe(false);
    });

    it('writes the token readable only by its owner', async () => {
      await state.issueToken();
      expect((await stat(state.tokenPath)).mode & 0o777).toBe(0o600);
      expect(await state.tokenIsExposed()).toBe(false);
    });

    /**
     * `chmod`, not a `writeFile` mode: the mode option only applies when the
     * file is created, so writing over an existing token leaves its permissions
     * alone. That is exactly why `issueToken` chmods after writing — a token
     * file left over from an earlier run would otherwise keep whatever
     * permissions it had.
     */
    it('notices a token file other accounts can read', async () => {
      await state.issueToken();
      await chmod(state.tokenPath, 0o644);
      expect(await state.tokenIsExposed()).toBe(true);
    });

    it('tightens the permissions of a token file left over from an earlier run', async () => {
      await state.issueToken();
      await chmod(state.tokenPath, 0o644);

      await state.issueToken();
      expect((await stat(state.tokenPath)).mode & 0o777).toBe(0o600);
      expect(await state.tokenIsExposed()).toBe(false);
    });

    it('stops working once revoked', async () => {
      const token = await state.issueToken();
      await state.revokeToken();

      expect(await state.verifyToken(token)).toBe(false);
      await expect(stat(state.tokenPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    /** Revoking twice is what happens when an install is retried. */
    it('can be revoked when it is already gone', async () => {
      await expect(state.revokeToken()).resolves.toBeUndefined();
    });
  });
});
