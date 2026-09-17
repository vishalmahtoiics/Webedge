import { posix } from 'node:path';

/**
 * Confines every file-manager path to one website's root (blueprint §22).
 *
 * This is the control that stops a customer reading `/etc/passwd`, another
 * customer's files, or WebEdge's own configuration through the file manager. It
 * is deliberately paranoid and deliberately boring: reject anything suspicious
 * rather than try to clean it up, because a sanitiser that rewrites input is a
 * sanitiser someone will find a way around.
 *
 * The order matters, and each step exists because skipping it is a known bypass:
 *
 *  1. Reject NUL bytes first. A NUL truncates the path in some C-based
 *     filesystem layers, so "safe.txt\0../../etc/passwd" passes a string check
 *     and then resolves to something else entirely.
 *  2. Decode percent-encoding exactly once, then reject any that remains.
 *     Decoding in a loop is what makes double-encoding (`%252e%252e`) work.
 *  3. Reject absolute paths and backslashes outright rather than converting them.
 *  4. Normalise, which collapses `.` and `..` segments arithmetically.
 *  5. Verify the result still starts with the root — the check that catches
 *     anything the earlier steps missed.
 */

export type PathResult =
  | { ok: true; absolutePath: string; relativePath: string }
  | { ok: false; reason: string };

/** Names that are never listed or reachable, wherever they appear. */
const DENIED_NAMES = new Set([
  '.ssh',
  '.bash_history',
  '.git',
  '.env',
  '.npmrc',
  '.aws',
  'authorized_keys',
  'id_rsa',
  'id_ed25519',
]);

const MAX_PATH_LENGTH = 4096;
const MAX_SEGMENT_LENGTH = 255;

const deny = (reason: string): PathResult => ({ ok: false, reason });

/**
 * Resolves a customer-supplied path against a website root.
 *
 * `root` must be absolute and already trusted — it comes from the website
 * record, never from the request.
 */
export function resolveWithinRoot(root: string, userPath: string): PathResult {
  if (!posix.isAbsolute(root)) {
    // A programming error rather than customer input, so it throws instead of
    // returning a rejection the caller might render.
    throw new Error(`Website root must be an absolute path, got "${root}"`);
  }

  if (typeof userPath !== 'string') return deny('Invalid path.');
  if (userPath.length > MAX_PATH_LENGTH) return deny('That path is too long.');

  // 1. NUL bytes, before anything else looks at the string.
  if (userPath.includes('\0')) return deny('Invalid path.');

  // 2. Decode exactly once. Decoding repeatedly is what lets %252e%252e through.
  let decoded: string;
  try {
    decoded = decodeURIComponent(userPath);
  } catch {
    return deny('Invalid path.');
  }
  if (decoded.includes('\0')) return deny('Invalid path.');

  // Anything still percent-encoded after one pass was encoded twice.
  if (/%[0-9a-f]{2}/i.test(decoded)) return deny('Invalid path.');

  // Control characters have no legitimate place in a filename here.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return deny('Invalid path.');

  // 3. Reject rather than convert. Converting backslashes would quietly accept
  //    Windows-style traversal instead of refusing it.
  if (decoded.includes('\\')) return deny('Invalid path.');

  // A leading slash is root-relative, the way a file manager's path bar works:
  // "/wp-content" means this website's wp-content, not the server's. It is
  // stripped rather than refused, and the boundary check below still applies, so
  // "/etc/passwd" addresses a folder inside the website rather than escaping it.
  const rootRelative = decoded.replace(/^\/+/, '');

  // Reject traversal by inspection as well as by resolution. Normalisation alone
  // would be enough, but a path that *tries* to escape is worth refusing
  // explicitly rather than silently clamping to the root.
  const rawSegments = rootRelative.split('/');
  if (rawSegments.includes('..')) return deny('Paths cannot contain "..".');

  for (const segment of rawSegments) {
    if (segment.length > MAX_SEGMENT_LENGTH) return deny('That file or folder name is too long.');
    if (DENIED_NAMES.has(segment.toLowerCase())) return deny('That file is not accessible.');
    // A segment of nothing but dots is never a legitimate name, and its presence
    // is a reliable sign of a traversal attempt dressed up to defeat naive
    // string-stripping (for example "....//", where removing one "../" leaves
    // another).
    if (/^\.{2,}$/.test(segment)) return deny('Invalid path.');
  }

  // 4. Normalise, then join.
  const normalisedRoot = posix.normalize(root).replace(/\/+$/, '') || '/';
  const joined = posix.normalize(posix.join(normalisedRoot, rootRelative));

  // 5. The check that catches whatever the rest missed. Compared with a trailing
  //    separator so "/home/site-a-evil" cannot pass as being inside "/home/site-a".
  const isRoot = joined === normalisedRoot;
  const isInside = joined.startsWith(`${normalisedRoot}/`);
  if (!isRoot && !isInside) return deny('That path is outside your website.');

  const relativePath = isRoot ? '/' : joined.slice(normalisedRoot.length);
  return { ok: true, absolutePath: joined, relativePath };
}

/**
 * Confirms a path the *filesystem* resolved is still inside the root.
 *
 * `resolveWithinRoot` works on strings and cannot see symlinks. After the SFTP
 * layer reports a real path, this checks it again — a symlink inside the website
 * pointing at `/etc` would otherwise pass every string check and still escape.
 */
export function isRealPathInsideRoot(root: string, realPath: string): boolean {
  const normalisedRoot = posix.normalize(root).replace(/\/+$/, '') || '/';
  const normalisedReal = posix.normalize(realPath);
  return normalisedReal === normalisedRoot || normalisedReal.startsWith(`${normalisedRoot}/`);
}

/**
 * Sanitises a name for a newly uploaded or created file.
 *
 * Unlike path resolution this does rewrite, because the name comes from a user's
 * own filesystem and rejecting it outright would be unhelpful — but it can only
 * ever produce a single path segment.
 */
export function sanitiseFileName(name: string): string | null {
  if (typeof name !== 'string') return null;

  // Take the last segment: an upload claiming "../../evil.php" becomes "evil.php".
  const base = posix.basename(name.replace(/\\/g, '/').replace(/\0/g, ''));

  // Leading dots are preserved: ".htaccess" is a legitimate file a customer
  // needs, and stripping the dot would silently rename it. Worse, stripping ran
  // before the denied-list check, so ".ssh" became "ssh" and passed. Dot-only
  // names are rejected outright instead, and the list is checked against the
  // real name.
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();

  if (cleaned.length === 0 || /^\.+$/.test(cleaned)) return null;
  if (cleaned.length > MAX_SEGMENT_LENGTH) return null;
  if (DENIED_NAMES.has(cleaned.toLowerCase())) return null;

  return cleaned;
}
