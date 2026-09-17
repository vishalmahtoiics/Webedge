import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Whether WebEdge is installed, and who is allowed to install it.
 *
 * Two separate problems, both of which have sunk CMS installers before:
 *
 *  - **After installation, the installer must be unreachable.** A setup wizard
 *    left live is an unauthenticated endpoint that rewrites the database
 *    connection and creates an administrator. It is the single most reliable way
 *    to lose a site, and "nobody knows the URL" is not a control.
 *
 *  - **Before installation, it must not be reachable by just anyone.** There is
 *    no administrator yet, so there is nobody to authenticate as. What can be
 *    required instead is proof of access to the server: the installer writes a
 *    one-time token to a file and prints it to the terminal of whoever started
 *    it, and the wizard will not answer without it. Someone who can read that
 *    file already has the filesystem.
 *
 * The lock lives on disk rather than in the database, deliberately. A database
 * that is unreachable, or has been pointed somewhere new, would otherwise read
 * as "not installed" and re-open the wizard on a live deployment.
 */

export const LOCK_FILENAME = 'install.lock';
export const TOKEN_FILENAME = 'install.token';

export type InstallRecord = {
  installedAt: string;
  version: string;
  /** What was seeded, so a later reset knows what it is undoing. */
  seeded: { schema: boolean; demoData: boolean; adminUser: boolean };
  /** The admin address, for support. Never the password. */
  adminEmail: string;
};

export class AlreadyInstalledError extends Error {
  constructor(readonly record: InstallRecord) {
    super('WebEdge is already installed. The setup wizard is closed.');
    this.name = 'AlreadyInstalledError';
  }
}

export class InstallState {
  constructor(private readonly stateDir: string) {}

  get lockPath(): string {
    return join(this.stateDir, LOCK_FILENAME);
  }

  get tokenPath(): string {
    return join(this.stateDir, TOKEN_FILENAME);
  }

  /**
   * The question every setup route asks first.
   *
   * Reads the filesystem every time rather than caching. A cached answer would
   * survive the lock being written by another process — and the wizard runs as
   * its own process, so that is the normal case rather than an edge one.
   */
  async isInstalled(): Promise<boolean> {
    return (await this.read()) !== null;
  }

  async read(): Promise<InstallRecord | null> {
    try {
      const raw = await readFile(this.lockPath, 'utf8');
      return JSON.parse(raw) as InstallRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      // A lock that exists but cannot be read is treated as installed. Failing
      // open here would re-open the wizard on a deployment whose disk is merely
      // having a bad day.
      throw error;
    }
  }

  /** Refuses to proceed when a lock is already present. */
  async assertNotInstalled(): Promise<void> {
    const record = await this.read();
    if (record) throw new AlreadyInstalledError(record);
  }

  /**
   * Writes the lock. Read-only to its owner and invisible to everyone else:
   * the file records when the install happened and under which address, which
   * is not something other accounts on the box need.
   */
  async lock(record: InstallRecord): Promise<void> {
    await mkdir(dirname(this.lockPath), { recursive: true });
    await writeFile(this.lockPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o400 });
    await chmod(this.lockPath, 0o400);
  }

  /**
   * Issues the setup token.
   *
   * Written with owner-only permissions and returned so the caller can print it
   * to the terminal. The point is not that it is secret forever — it is that
   * holding it proves access to this machine, which is the only thing that can
   * be proved before an administrator exists.
   */
  async issueToken(): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await mkdir(dirname(this.tokenPath), { recursive: true });
    await writeFile(this.tokenPath, `${token}\n`, { mode: 0o600 });
    await chmod(this.tokenPath, 0o600);
    return token;
  }

  /**
   * Checks a token from a request.
   *
   * Compared over SHA-256 digests with `timingSafeEqual`. Hashing first makes
   * both sides the same length, which `timingSafeEqual` requires and which a
   * caller can otherwise control by sending a short token — and comparing with
   * `===` would leak the token a character at a time to anyone patient.
   */
  async verifyToken(candidate: string): Promise<boolean> {
    let expected: string;
    try {
      expected = (await readFile(this.tokenPath, 'utf8')).trim();
    } catch {
      return false;
    }
    if (!expected) return false;

    const a = createHash('sha256').update(candidate.trim()).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  }

  /**
   * Removes the token once installation succeeds.
   *
   * The `.env` file is emphatically *not* removed with it — the application
   * needs it at runtime, and an installer that tidies away the configuration it
   * just wrote leaves a deployment that cannot start.
   */
  async revokeToken(): Promise<void> {
    await rm(this.tokenPath, { force: true });
  }

  /** Whether the token file is readable by anyone but its owner. */
  async tokenIsExposed(): Promise<boolean> {
    try {
      const info = await stat(this.tokenPath);
      return (info.mode & 0o077) !== 0;
    } catch {
      return false;
    }
  }

  /**
   * Re-opens installation. Deliberately not reachable over HTTP.
   *
   * Resetting means the next person to find the URL can repoint the database and
   * create themselves an administrator, so it is an action taken by someone with
   * a shell on the server, who has to name the lock file to remove it. There is
   * no button for this.
   */
  async unlockForReinstall(): Promise<void> {
    await rm(this.lockPath, { force: true });
  }
}
