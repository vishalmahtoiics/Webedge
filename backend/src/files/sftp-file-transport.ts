import { Injectable, Logger } from '@nestjs/common';
import SftpClient from 'ssh2-sftp-client';
import { posix } from 'node:path';
import { AppError } from '../common/errors';
import { isRealPathInsideRoot, resolveWithinRoot, sanitiseFileName } from './path-confinement';

/**
 * The file manager, over SFTP.
 *
 * Agency Hosting exposes no file API at all — not even listing — so SFTP is the
 * whole transport rather than a fallback for writes. That turns out simpler than
 * splitting across two mechanisms: SFTP covers rename, move and mkdir, which no
 * provider API here offers.
 *
 * Every operation resolves its path through `resolveWithinRoot` first, and every
 * operation that touches an existing entry then verifies the *real* path the
 * server reports. Both are needed: the first is a string check and cannot see
 * symlinks, and a symlink inside the website pointing at `/etc` passes every
 * string test while still escaping.
 *
 * Connections are per-operation rather than pooled. A pool keyed by website
 * would be faster, but a leaked connection is a leaked credential with
 * filesystem access, so correctness wins until there is a measured reason.
 */

export type SftpCredentials = {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Absolute path this website is confined to. From the website record. */
  root: string;
};

export type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifiedAt: string;
  /** A symlink is listed so the customer can see it, but never followed. */
  isSymlink: boolean;
};

/** Refuse to read a file into memory beyond this; the editor opens it read-only. */
const MAX_EDITABLE_BYTES = 2 * 1024 * 1024;

const CONNECT_TIMEOUT_MS = 15_000;

@Injectable()
export class SftpFileTransport {
  private readonly logger = new Logger(SftpFileTransport.name);

  /**
   * Opens a connection, runs one operation, and always closes.
   *
   * Provider errors are logged in full server-side and reduced to a safe message
   * for the customer — an SFTP error can carry the hostname and username, which
   * are leak-register material.
   */
  private async withClient<T>(
    creds: SftpCredentials,
    operation: string,
    fn: (client: SftpClient) => Promise<T>,
  ): Promise<T> {
    const client = new SftpClient();
    try {
      await client.connect({
        host: creds.host,
        port: creds.port,
        username: creds.username,
        password: creds.password,
        readyTimeout: CONNECT_TIMEOUT_MS,
      });
      return await fn(client);
    } catch (error) {
      if (error instanceof AppError) throw error;

      // A missing path must not read as an outage. `realPath` succeeds for a
      // file that does not exist — it canonicalises without checking — so the
      // ENOENT surfaces later from stat or get, and without this a mistyped
      // filename would tell the customer their website is unreachable.
      // The provider's message carries the full server path, so it is logged and
      // never forwarded.
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new AppError('RESOURCE_NOT_FOUND', 'That file was not found.');
      }

      if (code === 'EACCES' || code === 'EPERM') {
        throw new AppError('PERMISSION_DENIED', "You don't have access to that file.");
      }

      this.logger.error(
        `SFTP ${operation} failed for ${creds.username}@${creds.host}`,
        error instanceof Error ? error.message : String(error),
      );
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        "We couldn't reach your website's files right now. Try again in a few minutes.",
      );
    } finally {
      // end() can itself throw on an already-broken socket; a failure to close
      // must not mask the real error.
      await client.end().catch(() => undefined);
    }
  }

  /** Resolves a customer path, converting a rejection into a customer-safe error. */
  private resolve(creds: SftpCredentials, userPath: string): string {
    const result = resolveWithinRoot(creds.root, userPath);
    if (!result.ok) throw new AppError('INVALID_REQUEST', result.reason);
    return result.absolutePath;
  }

  /**
   * Verifies the path the server actually resolved is still inside the root.
   *
   * This is the symlink defence. `realPath` follows links, so a link inside the
   * website pointing at `/etc` resolves to `/etc` here and is refused, even
   * though its textual path was perfectly legitimate.
   */
  private async assertRealPathInside(
    client: SftpClient,
    creds: SftpCredentials,
    absolutePath: string,
  ): Promise<void> {
    let real: string;
    try {
      real = await client.realPath(absolutePath);
    } catch {
      // A path that cannot be resolved does not exist; report it as such rather
      // than leaking whether the parent directory was readable.
      throw new AppError('RESOURCE_NOT_FOUND', 'That file was not found.');
    }

    if (!isRealPathInsideRoot(creds.root, real)) {
      this.logger.warn(
        `Blocked symlink escape: ${absolutePath} resolves to ${real}, outside ${creds.root}`,
      );
      throw new AppError('INVALID_REQUEST', 'That path is outside your website.');
    }
  }

  async list(creds: SftpCredentials, userPath: string): Promise<FileEntry[]> {
    const absolutePath = this.resolve(creds, userPath);

    return this.withClient(creds, 'list', async (client) => {
      await this.assertRealPathInside(client, creds, absolutePath);
      const entries = await client.list(absolutePath);

      return entries
        .map((entry): FileEntry => {
          // ssh2-sftp-client reports 'd' directory, '-' file, 'l' symlink.
          const isSymlink = entry.type === 'l';
          return {
            name: entry.name,
            path: posix.join(userPath === '' ? '/' : userPath, entry.name),
            type: isSymlink ? 'symlink' : entry.type === 'd' ? 'directory' : 'file',
            size: entry.size,
            modifiedAt: new Date(entry.modifyTime).toISOString(),
            isSymlink,
          };
        })
        .sort((a, b) => {
          // Directories first, then by name — the ordering people expect.
          if (a.type === 'directory' && b.type !== 'directory') return -1;
          if (a.type !== 'directory' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        });
    });
  }

  async read(creds: SftpCredentials, userPath: string): Promise<{ content: string; size: number }> {
    const absolutePath = this.resolve(creds, userPath);

    return this.withClient(creds, 'read', async (client) => {
      await this.assertRealPathInside(client, creds, absolutePath);

      const stat = await client.stat(absolutePath);
      if (stat.isDirectory) {
        throw new AppError('INVALID_REQUEST', 'That is a folder, not a file.');
      }
      if (stat.size > MAX_EDITABLE_BYTES) {
        throw new AppError(
          'INVALID_REQUEST',
          'This file is too large to open in the editor. Download it instead.',
        );
      }

      const buffer = (await client.get(absolutePath)) as Buffer;

      // A NUL byte is the reliable signal of a binary file; opening one in a text
      // editor corrupts it on save.
      if (buffer.includes(0)) {
        throw new AppError(
          'INVALID_REQUEST',
          'This looks like a binary file. Download it instead of editing it.',
        );
      }

      return { content: buffer.toString('utf8'), size: stat.size };
    });
  }

  async write(creds: SftpCredentials, userPath: string, content: string): Promise<void> {
    const absolutePath = this.resolve(creds, userPath);

    await this.withClient(creds, 'write', async (client) => {
      // The parent must exist and be inside the root. Checking the parent rather
      // than the file itself is what makes this work for a file being created.
      await this.assertRealPathInside(client, creds, posix.dirname(absolutePath));

      // If the target already exists, it must not be a symlink out of the root.
      const existed = Boolean(await client.exists(absolutePath));
      let previousMode: number | undefined;

      if (existed) {
        await this.assertRealPathInside(client, creds, absolutePath);
        // Captured before the write, because put() does not preserve it.
        previousMode = (await client.stat(absolutePath)).mode & 0o7777;
      }

      await client.put(Buffer.from(content, 'utf8'), absolutePath);

      // put() creates the file with the server's own default, which observably
      // widens a 0644 file to 0666 — world-writable. On shared hosting that
      // lets any other account on the box rewrite the customer's PHP, so saving
      // a file through the editor would quietly weaken its permissions every
      // time. Restore what was there, and give new files 0644 rather than
      // whatever the server felt like.
      //
      // The world-writable bit is cleared even when it was already set. A file
      // the customer is editing in a web editor has no legitimate reason to be
      // writable by every account on the server, and a file already at 0666
      // — most likely damaged by this very bug before it was fixed — should not
      // stay that way just because it arrived here broken.
      const mode = (previousMode ?? 0o644) & ~0o002;
      await client.chmod(absolutePath, mode);
    });
  }

  async mkdir(creds: SftpCredentials, userPath: string, name: string): Promise<void> {
    const safeName = sanitiseFileName(name);
    if (!safeName) throw new AppError('INVALID_REQUEST', 'Enter a valid folder name.');

    const parent = this.resolve(creds, userPath);
    const target = posix.join(parent, safeName);

    await this.withClient(creds, 'mkdir', async (client) => {
      await this.assertRealPathInside(client, creds, parent);
      if (await client.exists(target)) {
        throw new AppError('CONFLICT', 'Something with that name already exists.');
      }
      await client.mkdir(target);
    });
  }

  async rename(creds: SftpCredentials, userPath: string, newName: string): Promise<void> {
    const safeName = sanitiseFileName(newName);
    if (!safeName) throw new AppError('INVALID_REQUEST', 'Enter a valid name.');

    const absolutePath = this.resolve(creds, userPath);
    const target = posix.join(posix.dirname(absolutePath), safeName);

    await this.withClient(creds, 'rename', async (client) => {
      await this.assertRealPathInside(client, creds, absolutePath);
      if (await client.exists(target)) {
        throw new AppError('CONFLICT', 'Something with that name already exists.');
      }
      await client.rename(absolutePath, target);
    });
  }

  /** Both ends are confined, so a move cannot be used to write outside the root. */
  async move(creds: SftpCredentials, fromPath: string, toPath: string): Promise<void> {
    const from = this.resolve(creds, fromPath);
    const to = this.resolve(creds, toPath);

    await this.withClient(creds, 'move', async (client) => {
      await this.assertRealPathInside(client, creds, from);
      await this.assertRealPathInside(client, creds, posix.dirname(to));
      if (await client.exists(to)) {
        throw new AppError('CONFLICT', 'Something with that name already exists.');
      }
      await client.rename(from, to);
    });
  }

  async remove(creds: SftpCredentials, userPath: string): Promise<void> {
    const absolutePath = this.resolve(creds, userPath);

    // Deleting the website root would wipe the site.
    if (isRealPathInsideRoot(creds.root, absolutePath) && absolutePath === posix.normalize(creds.root)) {
      throw new AppError('INVALID_REQUEST', 'The website root cannot be deleted.');
    }

    await this.withClient(creds, 'remove', async (client) => {
      const stat = await client.stat(absolutePath).catch(() => null);
      if (!stat) throw new AppError('RESOURCE_NOT_FOUND', 'That file was not found.');

      // A symlink is removed as a link. Following it here would delete whatever
      // it points at, which is how a delete inside the website erases /etc.
      if (!stat.isSymbolicLink) {
        await this.assertRealPathInside(client, creds, absolutePath);
      }

      if (stat.isDirectory) {
        await client.rmdir(absolutePath, true);
      } else {
        await client.delete(absolutePath);
      }
    });
  }

  /** Connection test for the resource-mapping wizard. */
  async testConnection(creds: SftpCredentials): Promise<{ ok: boolean; message: string }> {
    try {
      await this.withClient(creds, 'test', async (client) => {
        const real = await client.realPath(creds.root);
        if (!isRealPathInsideRoot(creds.root, real)) {
          throw new AppError('INVALID_REQUEST', 'The configured root does not resolve as expected.');
        }
        await client.list(creds.root);
      });
      return { ok: true, message: 'Connected and listed the website root.' };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof AppError ? error.message : 'Could not connect.',
      };
    }
  }
}
