import { describe, expect, it } from 'vitest';
import { isRealPathInsideRoot, resolveWithinRoot, sanitiseFileName } from './path-confinement';

const ROOT = '/home/site-alpha/public_html';

const resolve = (p: string) => resolveWithinRoot(ROOT, p);
const allowed = (p: string) => {
  const r = resolve(p);
  expect(r.ok, `expected "${p}" to be allowed, got: ${r.ok ? '' : r.reason}`).toBe(true);
  return r as Extract<typeof r, { ok: true }>;
};
const blocked = (p: string) => {
  const r = resolve(p);
  expect(r.ok, `expected "${p}" to be BLOCKED but it resolved`).toBe(false);
};

describe('legitimate paths', () => {
  it('resolves the root', () => {
    expect(allowed('').absolutePath).toBe(ROOT);
    expect(allowed('/').absolutePath).toBe(ROOT);
    expect(allowed('.').absolutePath).toBe(ROOT);
  });

  it('resolves nested files and folders', () => {
    expect(allowed('index.php').absolutePath).toBe(`${ROOT}/index.php`);
    expect(allowed('wp-content/themes/style.css').absolutePath).toBe(
      `${ROOT}/wp-content/themes/style.css`,
    );
  });

  it('reports a relative path for display', () => {
    expect(allowed('wp-content/uploads').relativePath).toBe('/wp-content/uploads');
    expect(allowed('/').relativePath).toBe('/');
  });

  it('allows dotfiles that are not on the denied list', () => {
    allowed('.htaccess');
    allowed('.gitignore');
  });

  it('allows names containing dots and unicode', () => {
    allowed('jquery.min.js');
    allowed('archive.tar.gz');
    allowed('ünïcödé-file.txt');
    allowed('日本語.txt');
  });

  it('collapses redundant separators and single dots', () => {
    expect(allowed('wp-content//themes/./style.css').absolutePath).toBe(
      `${ROOT}/wp-content/themes/style.css`,
    );
  });
});

describe('traversal', () => {
  it('blocks plain traversal', () => {
    blocked('..');
    blocked('../');
    blocked('../../etc/passwd');
    blocked('wp-content/../../../etc/passwd');
  });

  /** A traversal that lands back inside is still a traversal attempt. */
  it('blocks traversal even when it resolves back inside the root', () => {
    blocked('wp-content/../index.php');
  });

  it('blocks a leading traversal to a sibling website', () => {
    blocked('../../site-beta/public_html/config.php');
  });

  /**
   * "....//" defeats a naive implementation that strips "../" once: removing the
   * inner "../" from "....//"" leaves "../".
   */
  it('blocks the ....// collapse trick', () => {
    blocked('....//');
    blocked('....//....//etc/passwd');
  });

  /**
   * A leading slash is root-relative, as in a file manager path bar, so these
   * address folders *inside* the website rather than escaping it. The point is
   * that they resolve under the root, not that they are refused.
   */
  it('treats a leading slash as root-relative rather than absolute', () => {
    expect(allowed('/etc/passwd').absolutePath).toBe(`${ROOT}/etc/passwd`);
    expect(allowed('//wp-content').absolutePath).toBe(`${ROOT}/wp-content`);
  });

  /** Windows separators are refused rather than converted, so they cannot sneak
   *  a traversal past a POSIX-only check. */
  it('blocks backslash separators', () => {
    blocked('..\\..\\etc\\passwd');
    blocked('wp-content\\themes');
  });
});

describe('encoding attacks', () => {
  it('blocks percent-encoded traversal', () => {
    blocked('%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    blocked('..%2f..%2fetc%2fpasswd');
    blocked('%2e%2e/');
  });

  /**
   * Decoding in a loop is the classic bug: one pass turns %252e into %2e, and a
   * second turns it into a dot. Anything still encoded after one pass is
   * refused rather than decoded again.
   */
  it('blocks double-encoded traversal', () => {
    blocked('%252e%252e%252f');
    blocked('%252e%252e/etc/passwd');
  });

  it('blocks percent-encoded backslashes', () => {
    blocked('..%5c..%5cwindows');
  });

  /** %2f decodes to a leading slash, which is root-relative, so this lands
   *  inside the website rather than at the server's /etc. */
  it('resolves percent-encoded leading slashes under the root', () => {
    expect(allowed('%2fetc%2fpasswd').absolutePath).toBe(`${ROOT}/etc/passwd`);
  });

  it('rejects malformed percent-encoding rather than passing it through', () => {
    blocked('%zz');
    blocked('%');
  });
});

describe('NUL bytes and control characters', () => {
  /** A NUL truncates the path in some C filesystem layers, so a string check
   *  sees one path and the kernel opens another. */
  it('blocks NUL bytes, raw and encoded', () => {
    blocked('safe.txt\0../../etc/passwd');
    blocked('safe.txt%00.php');
    blocked('\0');
  });

  it('blocks other control characters', () => {
    blocked('file\nname.txt');
    blocked('file\rname.txt');
    blocked('file\ttab.txt');
  });
});

describe('sensitive names', () => {
  it('blocks credential and history files anywhere in the path', () => {
    blocked('.ssh');
    blocked('.ssh/authorized_keys');
    blocked('subdir/.ssh/id_rsa');
    blocked('.env');
    blocked('app/.git');
    blocked('.bash_history');
  });

  it('blocks them case-insensitively', () => {
    blocked('.SSH/authorized_keys');
    blocked('.Env');
  });

  /** Only exact segment names are denied — a file that merely contains the text
   *  is a normal file. */
  it('allows names that merely contain a denied word', () => {
    allowed('environment.txt');
    allowed('my.env.example');
    allowed('gitignore.txt');
  });
});

describe('limits', () => {
  it('rejects an overlong path', () => {
    blocked(`${'a/'.repeat(3000)}file.txt`);
  });

  it('rejects an overlong single segment', () => {
    blocked(`${'a'.repeat(300)}.txt`);
  });
});

describe('root boundary', () => {
  /** A prefix match without a separator would let "/home/site-alpha/public_html_evil"
   *  pass as being inside "/home/site-alpha/public_html". */
  it('does not treat a sibling with the same prefix as inside the root', () => {
    expect(isRealPathInsideRoot(ROOT, `${ROOT}_evil/file.txt`)).toBe(false);
    expect(isRealPathInsideRoot(ROOT, '/home/site-alphabet/public_html')).toBe(false);
  });

  it('accepts the root itself and paths under it', () => {
    expect(isRealPathInsideRoot(ROOT, ROOT)).toBe(true);
    expect(isRealPathInsideRoot(ROOT, `${ROOT}/index.php`)).toBe(true);
  });

  /**
   * String checks cannot see symlinks, so the resolved real path is checked
   * again after the filesystem reports it — a symlink inside the website
   * pointing at /etc passes every string test and still escapes.
   */
  it('rejects a real path that escaped through a symlink', () => {
    expect(isRealPathInsideRoot(ROOT, '/etc/passwd')).toBe(false);
    expect(isRealPathInsideRoot(ROOT, '/home/site-beta/public_html/config.php')).toBe(false);
  });

  it('handles a root given with a trailing slash', () => {
    const r = resolveWithinRoot('/home/site-alpha/public_html/', 'index.php');
    expect(r.ok && r.absolutePath).toBe('/home/site-alpha/public_html/index.php');
  });

  it('refuses a relative root as a programming error', () => {
    expect(() => resolveWithinRoot('relative/root', 'index.php')).toThrow(/absolute/i);
  });
});

describe('sanitiseFileName', () => {
  it('keeps ordinary names', () => {
    expect(sanitiseFileName('report.pdf')).toBe('report.pdf');
    expect(sanitiseFileName('My Photo (1).jpg')).toBe('My Photo (1).jpg');
  });

  /** An upload claiming a path is reduced to its final segment. */
  it('strips any path from an upload name', () => {
    expect(sanitiseFileName('../../evil.php')).toBe('evil.php');
    expect(sanitiseFileName('/etc/passwd')).toBe('passwd');
    expect(sanitiseFileName('..\\..\\evil.php')).toBe('evil.php');
  });

  it('strips NUL bytes and control characters', () => {
    expect(sanitiseFileName('safe\0.php')).toBe('safe.php');
    expect(sanitiseFileName('na\nme.txt')).toBe('name.txt');
  });

  it('rejects names that reduce to nothing', () => {
    expect(sanitiseFileName('')).toBeNull();
    expect(sanitiseFileName('...')).toBeNull();
    expect(sanitiseFileName('   ')).toBeNull();
  });

  it('rejects denied names', () => {
    expect(sanitiseFileName('.ssh')).toBeNull();
    expect(sanitiseFileName('id_rsa')).toBeNull();
  });

  it('rejects an overlong name', () => {
    expect(sanitiseFileName(`${'a'.repeat(300)}.txt`)).toBeNull();
  });
});
