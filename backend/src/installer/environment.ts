import { execFile } from 'node:child_process';
import { access, constants, mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { arch, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * What this machine is, and whether WebEdge can run on it.
 *
 * Detection exists so the installer can say "Node 22 is required and this is
 * Node 18" rather than failing halfway through a migration with a stack trace.
 * Every check here reports a fact; deciding what to do about it is
 * `preflight.ts`.
 */

export type Runtime = 'node' | 'npm' | 'psql' | 'pg_dump' | 'openssl';

export type VersionInfo = { present: boolean; version?: string; path?: string };

/**
 * Compares dotted versions numerically.
 *
 * `'9.0.0' < '10.0.0'` is false as a string comparison — lexicographically "9"
 * sorts after "1" — which is how a requirement of "at least 9" ends up
 * rejecting 10. Segments are compared as numbers, and a missing segment counts
 * as zero so "22" and "22.0.0" are the same version.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/i, '')
      // Stop at the first pre-release or build suffix: "22.1.0-rc.1" is 22.1.0
      // for the purpose of "is this new enough".
      .split(/[-+]/)[0]!
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function satisfiesMinimum(actual: string, minimum: string): boolean {
  return compareVersions(actual, minimum) >= 0;
}

/** Pulls the first dotted version out of a `--version` line. */
export function extractVersion(output: string): string | undefined {
  return /(\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1];
}

export type HostInfo = {
  platform: NodeJS.Platform;
  /** A name a person recognises, since `linux` and `win32` are not friendly. */
  label: string;
  arch: string;
  release: string;
  totalMemoryMib: number;
  /** Containers and VMs matter: a bind mount may be read-only. */
  containerised: boolean;
};

const PLATFORM_LABELS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
  freebsd: 'FreeBSD',
};

export async function detectHost(): Promise<HostInfo> {
  let containerised = false;
  try {
    // Present in every container runtime worth naming, absent on a plain host.
    await access('/.dockerenv', constants.F_OK);
    containerised = true;
  } catch {
    containerised = process.env.KUBERNETES_SERVICE_HOST !== undefined;
  }

  return {
    platform: platform(),
    label: PLATFORM_LABELS[platform()] ?? platform(),
    arch: arch(),
    release: release(),
    totalMemoryMib: Math.round(totalmem() / 1024 / 1024),
    containerised,
  };
}

/** Asks a command for its version. Absence is an answer, not an error. */
export async function detectCommand(command: string, args = ['--version']): Promise<VersionInfo> {
  try {
    const { stdout, stderr } = await run(command, args, { timeout: 5_000 });
    return { present: true, version: extractVersion(stdout || stderr) };
  } catch {
    return { present: false };
  }
}

export async function detectNode(): Promise<VersionInfo> {
  return { present: true, version: process.versions.node, path: process.execPath };
}

/**
 * Whether a directory can be written to.
 *
 * Tested by actually creating something, not by reading the mode bits. A
 * read-only bind mount, a full disk and an immutable attribute all present as
 * writable permissions and fail on write — which is precisely the failure this
 * check exists to catch before a migration is half-run.
 */
export async function canWrite(directory: string): Promise<{ writable: boolean; reason?: string }> {
  try {
    const probe = await mkdtemp(join(directory, '.webedge-write-test-'));
    await rm(probe, { recursive: true, force: true });
    return { writable: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const reason =
      code === 'EACCES' || code === 'EPERM'
        ? 'permission denied'
        : code === 'EROFS'
          ? 'the filesystem is mounted read-only'
          : code === 'ENOSPC'
            ? 'the disk is full'
            : code === 'ENOENT'
              ? 'the directory does not exist'
              : `write failed (${code ?? 'unknown error'})`;
    return { writable: false, reason };
  }
}

/**
 * Whether a TCP port can be bound.
 *
 * Bound on the interface that will actually be used. A port free on 127.0.0.1
 * and taken on 0.0.0.0 is a real and confusing difference, and checking the
 * wrong one produces an installer that says the port is free and a server that
 * cannot start.
 */
export async function portIsFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/** Whether a path exists at all, for finding an existing `.env`. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export type EnvironmentReport = {
  host: HostInfo;
  node: VersionInfo;
  npm: VersionInfo;
  psql: VersionInfo;
  openssl: VersionInfo;
};

export async function detectEnvironment(): Promise<EnvironmentReport> {
  const [host, node, npm, psql, openssl] = await Promise.all([
    detectHost(),
    detectNode(),
    detectCommand('npm'),
    detectCommand('psql'),
    detectCommand('openssl'),
  ]);

  return { host, node, npm, psql, openssl };
}
