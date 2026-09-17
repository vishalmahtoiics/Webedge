/**
 * Rendering the `.env` file.
 *
 * This is the part of the installer where a mistake is a vulnerability rather
 * than an inconvenience. Values arrive from a web form — a database password, an
 * application URL — and are written into a file that is parsed as configuration
 * and, in some deployments, sourced by a shell. A password containing a newline
 * would otherwise end the line and start a new key:
 *
 *     DATABASE_URL="postgres://u:pw
 *     COOKIE_SECURE=false"
 *
 * That is configuration injection: whoever chose the password chose the setting.
 * Every value here is therefore quoted and escaped, and anything that cannot be
 * represented safely is refused at the door rather than mangled quietly.
 *
 * The format targeted is dotenv's, which is what Prisma and `@nestjs/config`
 * both read.
 */

/** Keys whose values must never be written to a log or echoed back to a browser. */
export const SECRET_KEYS = new Set([
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'CREDENTIAL_ENCRYPTION_KEY',
  'SEED_ADMIN_PASSWORD',
]);

export class UnsafeEnvValueError extends Error {
  constructor(
    readonly key: string,
    reason: string,
  ) {
    super(`${key}: ${reason}`);
    this.name = 'UnsafeEnvValueError';
  }
}

/**
 * Quotes a value for dotenv.
 *
 * Single quotes, because dotenv treats a single-quoted value as entirely
 * literal — no escape sequences, no interpolation. Backslashes, double quotes,
 * `#`, `$`, `=`, leading and trailing spaces and real newlines all survive
 * unchanged, and a shell sourcing the file expands nothing inside them either.
 *
 * This was not the first implementation. The first one double-quoted and escaped
 * `\\`, `"`, `\n` and `\r`, which is what most formats want and what dotenv
 * does not do: inside double quotes dotenv expands only `\n` and `\r`, and
 * leaves `\"` and `\\` as the two literal characters they are. Every password
 * containing a quote or a backslash would have been silently corrupted. Parsing
 * the rendered file back with the real dotenv is what caught it.
 *
 * The one thing single quotes cannot carry is a single quote. Such a value falls
 * back to double quotes, which can carry it — but double quotes reintroduce
 * dotenv's `\n` expansion and cannot escape a `"`, and a shell would expand a
 * backtick inside them. A value needing both quote characters, or one carrying a
 * literal `\n` alongside an apostrophe, simply cannot be represented in this
 * format. It is refused with an explanation rather than written wrong.
 */
export function quoteEnvValue(key: string, value: string): string {
  // A NUL cannot survive a file read on any path this value takes, and no
  // person typed one.
  if (value.includes('\0')) {
    throw new UnsafeEnvValueError(key, 'must not contain a null byte');
  }

  // dotenv normalises CRLF to LF before parsing, so a carriage return inside a
  // value silently becomes a bare newline. Nothing configured here legitimately
  // contains one, and storing a value that reads back differently is worse than
  // saying it cannot be stored. Found by round-tripping, not by reading the
  // parser.
  if (value.includes('\r')) {
    throw new UnsafeEnvValueError(
      key,
      'must not contain a carriage return — the file format silently turns it into a line feed',
    );
  }

  if (!value.includes("'")) return `'${value}'`;

  // From here the value must be double-quoted, where dotenv and the shell both
  // start interpreting things.
  if (value.includes('"')) {
    throw new UnsafeEnvValueError(
      key,
      'cannot contain both a single and a double quote — an .env file has no way to carry both. ' +
        'Change the value, or set this one as a real environment variable instead',
    );
  }
  if (/\\[nr]/.test(value)) {
    throw new UnsafeEnvValueError(
      key,
      'cannot contain an apostrophe together with a literal backslash-n or backslash-r — ' +
        'the file format would turn one of them into a line break',
    );
  }
  if (value.includes('`') || value.includes('$(')) {
    throw new UnsafeEnvValueError(
      key,
      'cannot contain an apostrophe together with a backtick or "$(" — those would execute ' +
        'if the file were sourced by a shell',
    );
  }

  return `"${value}"`;
}

export type EnvSection = {
  title: string;
  comment?: string;
  entries: Array<{ key: string; value: string; comment?: string }>;
};

/**
 * Renders the whole file.
 *
 * Comments are carried through, because the file a person opens six months
 * later should explain itself as well as `.env.example` does. The installer
 * writing an unannotated wall of keys is how nobody dares change one.
 */
export function renderEnvFile(sections: EnvSection[], header?: string): string {
  const lines: string[] = [];

  if (header) {
    for (const line of header.split('\n')) lines.push(`# ${line}`.trimEnd());
    lines.push('');
  }

  for (const section of sections) {
    lines.push(`# ${'─'.repeat(3)} ${section.title} ${'─'.repeat(Math.max(3, 70 - section.title.length))}`);
    if (section.comment) {
      for (const line of section.comment.split('\n')) lines.push(`# ${line}`.trimEnd());
    }

    for (const entry of section.entries) {
      if (entry.comment) {
        for (const line of entry.comment.split('\n')) lines.push(`# ${line}`.trimEnd());
      }
      lines.push(`${entry.key}=${quoteEnvValue(entry.key, entry.value)}`);
    }

    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Builds a PostgreSQL connection string from the parts a form collects.
 *
 * Every component is percent-encoded. A password containing `@` or `/` — both
 * perfectly ordinary — would otherwise be read as the start of the host or the
 * database name, and the connection would fail with an error naming a host
 * nobody configured.
 */
export function buildDatabaseUrl(input: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema?: string;
}): string {
  const user = encodeURIComponent(input.user);
  const password = encodeURIComponent(input.password);
  // An IPv6 literal has to be bracketed or the colons read as a port separator.
  const host = input.host.includes(':') && !input.host.startsWith('[')
    ? `[${input.host}]`
    : input.host;
  const database = encodeURIComponent(input.database);
  const schema = encodeURIComponent(input.schema ?? 'public');

  return `postgresql://${user}:${password}@${host}:${input.port}/${database}?schema=${schema}`;
}

/** Replaces secret values with a marker, for anything that will be displayed. */
export function redactEnv(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = SECRET_KEYS.has(key) ? '<hidden>' : value;
  }
  return out;
}
