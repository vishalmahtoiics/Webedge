import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SftpFileTransport, type SftpCredentials } from '../src/files/sftp-file-transport';

/**
 * The file manager against a real SFTP server.
 *
 * Mocking SFTP here would prove nothing: the whole point is that a symlink
 * inside the website resolves outside it, and only a real filesystem can
 * demonstrate that. The fixture plants `escape-hatch -> /etc` inside the website
 * root precisely so the escape can be attempted for real.
 *
 * Requires the local test server:
 *   /usr/sbin/sshd -f /etc/ssh/test/sshd_config
 * with a `wetest` user whose public_html contains the fixture.
 */
const creds: SftpCredentials = {
  host: '127.0.0.1',
  port: 2222,
  username: 'wetest',
  password: 'sftp-test-password',
  root: '/home/wetest/public_html',
};

const transport = new SftpFileTransport();

const reachable = async (): Promise<boolean> => (await transport.testConnection(creds)).ok;

describe('SFTP file transport', () => {
  beforeAll(async () => {
    if (!(await reachable())) {
      throw new Error(
        'Local SFTP test server is not reachable on 127.0.0.1:2222. ' +
          'Start it before running this suite.',
      );
    }
  });

  afterAll(async () => {
    // Leave the fixture as found, so the suite can be re-run.
    for (const path of ['new-folder', 'written.txt', 'renamed.txt', 'moved.txt', 'wp-content/moved.txt']) {
      await transport.remove(creds, path).catch(() => undefined);
    }
  });

  describe('reading', () => {
    it('lists the website root with directories first', async () => {
      const entries = await transport.list(creds, '/');
      const names = entries.map((e) => e.name);

      expect(names).toContain('index.php');
      expect(names).toContain('wp-content');
      expect(entries[0]?.type).toBe('directory');
    });

    /** A symlink is shown so the customer knows it is there, but flagged. */
    it('lists a symlink without following it', async () => {
      const entries = await transport.list(creds, '/');
      const link = entries.find((e) => e.name === 'escape-hatch');

      expect(link).toBeDefined();
      expect(link?.isSymlink).toBe(true);
      expect(link?.type).toBe('symlink');
    });

    it('reads a file', async () => {
      const { content } = await transport.read(creds, 'index.php');
      expect(content).toContain('hello');
    });

    it('reads a nested file', async () => {
      const { content } = await transport.read(creds, 'wp-content/themes/style.css');
      expect(content).toContain('#0A7285');
    });

    it('reads a dotfile customers legitimately edit', async () => {
      const { content } = await transport.read(creds, '.htaccess');
      expect(content).toContain('Options -Indexes');
    });

    it('refuses to read a directory as a file', async () => {
      await expect(transport.read(creds, 'wp-content')).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
    });
  });

  describe('writing', () => {
    it('writes a new file and reads it back', async () => {
      await transport.write(creds, 'written.txt', 'written by the test');
      expect((await transport.read(creds, 'written.txt')).content).toBe('written by the test');
    });

    it('overwrites an existing file', async () => {
      await transport.write(creds, 'written.txt', 'second version');
      expect((await transport.read(creds, 'written.txt')).content).toBe('second version');
    });

    it('creates a folder', async () => {
      await transport.mkdir(creds, '/', 'new-folder');
      expect((await transport.list(creds, '/')).map((e) => e.name)).toContain('new-folder');
    });

    it('refuses to create a folder that already exists', async () => {
      await expect(transport.mkdir(creds, '/', 'wp-content')).rejects.toMatchObject({
        response: { code: 'CONFLICT' },
      });
    });

    it('renames a file', async () => {
      await transport.rename(creds, 'written.txt', 'renamed.txt');
      const names = (await transport.list(creds, '/')).map((e) => e.name);
      expect(names).toContain('renamed.txt');
      expect(names).not.toContain('written.txt');
    });

    it('moves a file into a subdirectory', async () => {
      await transport.move(creds, 'renamed.txt', 'wp-content/moved.txt');
      expect((await transport.list(creds, 'wp-content')).map((e) => e.name)).toContain('moved.txt');
    });

    /**
     * ssh2-sftp-client's put() does not preserve the file mode: it observably
     * widens a 0644 file to 0666. World-writable PHP on shared hosting means any
     * other account on the box can rewrite the customer's site, so saving from
     * the editor would weaken permissions a little more each time.
     */
    it('preserves the file mode when overwriting', async () => {
      const { chmodSync, statSync } = await import('node:fs');
      const real = '/home/wetest/public_html/mode-check.php';

      // Created through the transport so it is owned by the SFTP user; a file
      // written here as root could not be chmod'd over SFTP at all.
      await transport.write(creds, 'mode-check.php', 'original');
      chmodSync(real, 0o644);

      await transport.write(creds, 'mode-check.php', 'overwritten by the test');

      expect(statSync(real).mode & 0o7777).toBe(0o644);
      await transport.remove(creds, 'mode-check.php');
    });

    /** A file already at 0666 is almost certainly damage, not intent. */
    it('clears the world-writable bit even when it was already set', async () => {
      const { chmodSync, statSync } = await import('node:fs');
      const real = '/home/wetest/public_html/already-wide.txt';

      await transport.write(creds, 'already-wide.txt', 'original');
      chmodSync(real, 0o666);

      await transport.write(creds, 'already-wide.txt', 'overwritten');

      expect(statSync(real).mode & 0o002).toBe(0);
      await transport.remove(creds, 'already-wide.txt');
    });

    it('creates new files as 0644 rather than world-writable', async () => {
      const { statSync } = await import('node:fs');
      await transport.write(creds, 'fresh-file.txt', 'new');

      expect(statSync('/home/wetest/public_html/fresh-file.txt').mode & 0o7777).toBe(0o644);
      await transport.remove(creds, 'fresh-file.txt');
    });

    it('deletes a file', async () => {
      await transport.write(creds, 'to-delete.txt', 'x');
      await transport.remove(creds, 'to-delete.txt');
      expect((await transport.list(creds, '/')).map((e) => e.name)).not.toContain('to-delete.txt');
    });
  });

  /**
   * The reason this suite runs against a real server. Every case below has a
   * textually legitimate path; only the filesystem reveals where it actually
   * goes.
   */
  describe('escape attempts', () => {
    it('blocks traversal above the root', async () => {
      await expect(transport.list(creds, '../')).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
      await expect(transport.read(creds, '../../etc/passwd')).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
    });

    /**
     * "escape-hatch" is a real symlink to /etc inside the website. Its path
     * contains no traversal at all, so every string check passes — it is caught
     * only because the server's resolved real path lands outside the root.
     */
    it('blocks listing through a symlink that points outside the root', async () => {
      await expect(transport.list(creds, 'escape-hatch')).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
    });

    it('blocks reading a file through that symlink', async () => {
      await expect(transport.read(creds, 'escape-hatch/passwd')).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
    });

    it('blocks writing through that symlink', async () => {
      await expect(transport.write(creds, 'escape-hatch/webedge-was-here', 'x')).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
      // And nothing was actually written outside the root.
      const { existsSync } = await import('node:fs');
      expect(existsSync('/etc/webedge-was-here')).toBe(false);
    });

    /**
     * Deleting a symlink removes the link, never its target. Following it here
     * is how a delete inside the website would erase /etc.
     */
    it('removes a symlink as a link rather than following it', async () => {
      await transport.write(creds, 'link-target.txt', 'target content');
      const { symlinkSync, existsSync, unlinkSync } = await import('node:fs');
      symlinkSync('/home/wetest/public_html/link-target.txt', '/home/wetest/public_html/a-link');

      try {
        await transport.remove(creds, 'a-link');
        expect(existsSync('/home/wetest/public_html/a-link')).toBe(false);
        // The target survived.
        expect((await transport.read(creds, 'link-target.txt')).content).toBe('target content');
      } finally {
        if (existsSync('/home/wetest/public_html/a-link')) unlinkSync('/home/wetest/public_html/a-link');
        await transport.remove(creds, 'link-target.txt').catch(() => undefined);
      }
    });

    it('blocks access to denied names', async () => {
      await expect(transport.read(creds, '.ssh/id_rsa')).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
    });

    it('refuses to delete the website root', async () => {
      await expect(transport.remove(creds, '/')).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
    });

    it('reports a missing file as not found, not as an outage', async () => {
      await expect(transport.read(creds, 'does-not-exist.txt')).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
    });

    /**
     * The server's own ENOENT message is "_xstat: No such file:
     * /home/wetest/public_html/nope.txt" — it carries the full server path and
     * therefore the account username, which is leak-register material.
     */
    it('does not leak the server path or username in a not-found message', async () => {
      const error = await transport.read(creds, 'does-not-exist.txt').catch((e: unknown) => e);
      const serialised = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error as object),
      );

      expect(serialised).not.toContain(creds.username);
      expect(serialised).not.toContain(creds.root);
      expect(serialised).not.toContain('_xstat');
    });
  });

  describe('connection test', () => {
    it('succeeds against a reachable server', async () => {
      const result = await transport.testConnection(creds);
      expect(result.ok).toBe(true);
    });

    /** Failure must not leak the hostname or username into the message. */
    it('fails safely with wrong credentials', async () => {
      const result = await transport.testConnection({ ...creds, password: 'wrong' });

      expect(result.ok).toBe(false);
      expect(result.message).not.toContain(creds.username);
      expect(result.message).not.toContain(creds.host);
    });
  });
});
