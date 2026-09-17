import { describe, expect, it } from 'vitest';
import { parse } from 'dotenv';
import {
  UnsafeEnvValueError, buildDatabaseUrl, quoteEnvValue, redactEnv, renderEnvFile,
} from './env-file';

/**
 * The installer writes `.env` from values typed into a web form. A value that
 * escapes its own line stops being a password and becomes a configuration
 * setting, chosen by whoever supplied it — so every case here is checked by
 * parsing the rendered file back with the same dotenv the application uses,
 * rather than by looking at the string.
 */
const roundTrip = (key: string, value: string): string | undefined => {
  const file = renderEnvFile([{ title: 'Test', entries: [{ key, value }] }]);
  return parse(file)[key];
};

describe('quoting a value', () => {
  it('round-trips an ordinary value', () => {
    expect(roundTrip('PORT', '4000')).toBe('4000');
    expect(roundTrip('CLIENT_ORIGIN', 'https://panel.example.com')).toBe(
      'https://panel.example.com',
    );
  });

  /**
   * The injection this module exists to prevent. Without escaping, the newline
   * ends the line and everything after it is parsed as further configuration.
   */
  it('refuses to let a newline start a new setting', () => {
    const password = 'secret\nCOOKIE_SECURE=false';
    const file = renderEnvFile([
      { title: 'Test', entries: [{ key: 'DB_PASSWORD', value: password }] },
    ]);
    const parsed = parse(file);

    expect(parsed.DB_PASSWORD).toBe(password);
    expect(parsed.COOKIE_SECURE, 'the value must not have become a setting').toBeUndefined();
  });

  it('round-trips quotes, backslashes and hashes', () => {
    for (const value of [
      'has "double" quotes',
      "has 'single' quotes",
      'back\\slash',
      'trailing\\',
      'hash # not a comment',
      'equals=inside',
      'spaces  around  ',
      '{"json":"value"}',
      'सॉफ़्टवेयर 🔐',
    ]) {
      expect(roundTrip('VALUE', value), JSON.stringify(value)).toBe(value);
    }
  });

  it('round-trips a tab and a bare newline', () => {
    expect(roundTrip('VALUE', 'a\tb')).toBe('a\tb');
    expect(roundTrip('VALUE', 'two\nlines')).toBe('two\nlines');
  });

  /**
   * dotenv normalises CRLF to LF before parsing, so a carriage return reads back
   * as a plain newline. Nothing here legitimately contains one, and a value that
   * comes back different from what went in is worse than one that is refused.
   */
  it('refuses a carriage return, which cannot round-trip', () => {
    expect(() => quoteEnvValue('VALUE', 'a\r\nb')).toThrow(UnsafeEnvValueError);
  });

  it('round-trips an apostrophe, which single quotes cannot carry', () => {
    expect(roundTrip('VALUE', "it's fine")).toBe("it's fine");
  });

  /**
   * Single quotes are literal to both dotenv and a shell, so a backtick inside
   * them is inert. It is only dangerous in the double-quoted fallback, and that
   * is where it is refused — rather than rejecting a character every password
   * generator may legitimately produce.
   */
  it('allows a backtick and a dollar sign on their own', () => {
    expect(roundTrip('VALUE', 'a`whoami`b')).toBe('a`whoami`b');
    expect(roundTrip('VALUE', 'a$(whoami)b')).toBe('a$(whoami)b');
    expect(roundTrip('VALUE', 'pa$$word')).toBe('pa$$word');
  });

  it('refuses a backtick once an apostrophe forces double quotes', () => {
    expect(() => quoteEnvValue('VALUE', "it's `whoami`")).toThrow(UnsafeEnvValueError);
    expect(() => quoteEnvValue('VALUE', "it's $(whoami)")).toThrow(UnsafeEnvValueError);
  });

  /**
   * An .env file has no way to carry both quote characters in one value. Said
   * plainly and refused, rather than written wrong — which is what the first
   * version of this module did, escaping `\"` in a way dotenv does not unescape.
   */
  it('refuses a value needing both quote characters, with an explanation', () => {
    const attempt = () => quoteEnvValue('DB_PASSWORD', `both ' and " quotes`);
    expect(attempt).toThrow(UnsafeEnvValueError);
    expect(attempt).toThrow(/no way to carry both/);
  });

  it('refuses an apostrophe alongside a literal backslash-n', () => {
    expect(() => quoteEnvValue('VALUE', String.raw`it's a \n`)).toThrow(UnsafeEnvValueError);
  });

  it('refuses a null byte', () => {
    expect(() => quoteEnvValue('VALUE', 'a\u0000b')).toThrow(UnsafeEnvValueError);
  });

  it('names the key in the error, so the form can point at the field', () => {
    try {
      quoteEnvValue('DATABASE_PASSWORD', `both ' and " quotes`);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnsafeEnvValueError).key).toBe('DATABASE_PASSWORD');
    }
  });
});

describe('rendering the file', () => {
  it('keeps the comments, so the file explains itself later', () => {
    const file = renderEnvFile(
      [
        {
          title: 'Sessions',
          comment: 'Rotate these and every session ends.',
          entries: [{ key: 'JWT_ACCESS_SECRET', value: 'x'.repeat(64), comment: '32 bytes, hex.' }],
        },
      ],
      'Generated by the WebEdge installer.',
    );

    expect(file).toContain('# Generated by the WebEdge installer.');
    expect(file).toContain('Rotate these and every session ends.');
    expect(file).toContain('# 32 bytes, hex.');
    expect(parse(file).JWT_ACCESS_SECRET).toBe('x'.repeat(64));
  });

  it('ends with exactly one newline', () => {
    const file = renderEnvFile([{ title: 'T', entries: [{ key: 'A', value: '1' }] }]);
    expect(file.endsWith('\n')).toBe(true);
    expect(file.endsWith('\n\n')).toBe(false);
  });
});

describe('building the database URL', () => {
  it('builds an ordinary connection string', () => {
    expect(
      buildDatabaseUrl({
        host: 'localhost',
        port: 5432,
        database: 'webedge',
        user: 'webedge',
        password: 'simple',
      }),
    ).toBe('postgresql://webedge:simple@localhost:5432/webedge?schema=public');
  });

  /**
   * `@` and `/` in a password are ordinary and, unencoded, are read as the start
   * of the host and of the database name. The connection then fails naming a
   * host nobody configured, which is a support call rather than a clear error.
   */
  it('encodes a password containing URL syntax', () => {
    const url = buildDatabaseUrl({
      host: 'db.internal',
      port: 5432,
      database: 'webedge',
      user: 'web@edge',
      password: 'p@ss/w:rd?#',
    });

    const parsed = new URL(url);
    expect(decodeURIComponent(parsed.username)).toBe('web@edge');
    expect(decodeURIComponent(parsed.password)).toBe('p@ss/w:rd?#');
    expect(parsed.hostname).toBe('db.internal');
    expect(parsed.pathname).toBe('/webedge');
  });

  /** Unbracketed, the colons in an IPv6 address read as a port separator. */
  it('brackets an IPv6 host', () => {
    const url = buildDatabaseUrl({
      host: '2001:db8::1',
      port: 5432,
      database: 'webedge',
      user: 'webedge',
      password: 'x',
    });

    expect(url).toContain('@[2001:db8::1]:5432/');
    expect(new URL(url).port).toBe('5432');
  });

  it('survives being quoted into the file', () => {
    const url = buildDatabaseUrl({
      host: 'localhost',
      port: 5432,
      database: 'webedge',
      user: 'webedge',
      password: 'p@ss"word\\with#everything$and`backtick`',
    });

    expect(roundTrip('DATABASE_URL', url)).toBe(url);
  });
});

describe('redaction', () => {
  /** Anything displayed back to a browser goes through here first. */
  it('hides the values that are secrets and keeps the ones that are not', () => {
    const redacted = redactEnv({
      DATABASE_URL: 'postgresql://webedge:hunter2@localhost:5432/webedge',
      JWT_ACCESS_SECRET: 'a'.repeat(64),
      CLIENT_ORIGIN: 'https://panel.example.com',
      PORT: '4000',
    });

    expect(redacted.DATABASE_URL).toBe('<hidden>');
    expect(redacted.JWT_ACCESS_SECRET).toBe('<hidden>');
    expect(redacted.CLIENT_ORIGIN).toBe('https://panel.example.com');
    expect(JSON.stringify(redacted)).not.toContain('hunter2');
  });
});
