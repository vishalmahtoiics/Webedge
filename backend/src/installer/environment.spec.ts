import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canWrite, compareVersions, detectCommand, detectEnvironment, extractVersion, portIsFree,
  satisfiesMinimum,
} from './environment';

describe('comparing versions', () => {
  /**
   * The reason this is not a string comparison. Lexicographically "9" sorts
   * after "1", so `'9.0.0' < '10.0.0'` is false — which is how a requirement of
   * "at least 9" ends up rejecting version 10.
   */
  it('compares numerically, not lexicographically', () => {
    expect(compareVersions('10.0.0', '9.0.0')).toBe(1);
    expect(compareVersions('9.0.0', '10.0.0')).toBe(-1);
    expect(satisfiesMinimum('10.0.0', '9.0.0')).toBe(true);
    expect(satisfiesMinimum('22.22.2', '22.9.0')).toBe(true);
  });

  it('treats a missing segment as zero', () => {
    expect(compareVersions('22', '22.0.0')).toBe(0);
    expect(compareVersions('22.1', '22.0.9')).toBe(1);
  });

  it('ignores a leading v', () => {
    expect(compareVersions('v22.1.0', '22.1.0')).toBe(0);
  });

  /** A release candidate is the version it is a candidate for, near enough. */
  it('ignores a pre-release or build suffix', () => {
    expect(compareVersions('22.1.0-rc.1', '22.1.0')).toBe(0);
    expect(compareVersions('16.4+build7', '16.4')).toBe(0);
  });

  it('reports equality', () => {
    expect(compareVersions('16.13', '16.13')).toBe(0);
    expect(satisfiesMinimum('16.13', '16.13')).toBe(true);
  });

  it('refuses a version below the minimum', () => {
    expect(satisfiesMinimum('18.20.0', '22.0.0')).toBe(false);
    expect(satisfiesMinimum('14.9', '15')).toBe(false);
  });
});

describe('reading a version out of command output', () => {
  it('finds the version in the shapes these tools actually print', () => {
    expect(extractVersion('v22.22.2')).toBe('22.22.2');
    expect(extractVersion('10.9.7')).toBe('10.9.7');
    expect(extractVersion('psql (PostgreSQL) 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)')).toBe('16.13');
    expect(extractVersion('OpenSSL 3.0.13 30 Jan 2024')).toBe('3.0.13');
  });

  it('returns nothing when there is no version to find', () => {
    expect(extractVersion('command not found')).toBeUndefined();
    expect(extractVersion('')).toBeUndefined();
  });
});

describe('detecting a command', () => {
  it('finds one that is installed', async () => {
    const node = await detectCommand('node');
    expect(node.present).toBe(true);
    expect(node.version).toBeDefined();
  });

  /** Absence is an answer the installer reports, not an error it throws. */
  it('reports a missing command rather than throwing', async () => {
    const missing = await detectCommand('webedge-definitely-not-a-real-command');
    expect(missing.present).toBe(false);
    expect(missing.version).toBeUndefined();
  });
});

describe('checking a directory is writable', () => {
  it('accepts a directory it can write to', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'webedge-env-'));
    expect(await canWrite(dir)).toEqual({ writable: true });
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * Tested by writing rather than by reading mode bits: a read-only mount, a
   * full disk and an immutable attribute all look writable in the metadata and
   * fail on the write, which is the failure worth catching before a migration
   * is half-run.
   */
  it('reports why it cannot write, in words a person can act on', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'webedge-env-'));
    await chmod(dir, 0o500);

    const result = await canWrite(dir);
    // Running as root defeats permission bits entirely, which is worth saying
    // rather than asserting something untrue about the environment.
    if (process.getuid?.() === 0) {
      expect(result.writable, 'root ignores the mode, so this case cannot be exercised').toBe(true);
    } else {
      expect(result.writable).toBe(false);
      expect(result.reason).toBe('permission denied');
    }

    await chmod(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
  });

  it('reports a directory that is not there', async () => {
    const result = await canWrite(join(tmpdir(), 'webedge-does-not-exist-at-all'));
    expect(result.writable).toBe(false);
    expect(result.reason).toBe('the directory does not exist');
  });
});

describe('checking a port', () => {
  it('reports a free port as free', async () => {
    // Port 0 asks the OS for any free port, which is then closed again.
    const probe = createServer();
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    expect(await portIsFree(port)).toBe(true);
  });

  it('reports a port in use as taken', async () => {
    const server = createServer();
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });

    expect(await portIsFree(port)).toBe(false);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe('the whole report', () => {
  it('describes this machine without throwing on anything missing', async () => {
    const report = await detectEnvironment();

    expect(report.node.present).toBe(true);
    expect(report.host.label).toBeTruthy();
    expect(report.host.totalMemoryMib).toBeGreaterThan(0);
    // psql and openssl may or may not be here; what matters is that a report
    // comes back either way.
    expect(typeof report.psql.present).toBe('boolean');
    expect(typeof report.openssl.present).toBe('boolean');
  });
});
