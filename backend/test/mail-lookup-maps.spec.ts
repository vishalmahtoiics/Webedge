import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { MailDomainsService } from '../src/mail/mail-domains.service';
import { hashMailboxPassword } from '../src/mail/mail-password';
import type { PrismaService } from '../src/prisma/prisma.service';

const run = promisify(execFile);

/**
 * The Postfix lookup maps, run through a real `postmap -q` against the real
 * database.
 *
 * These queries are the second line of defence, and the reason they are tested
 * separately from the panel. The panel refuses to build on a domain whose
 * ownership has not been proved — but the panel is not what answers the
 * connection on port 25. If a `mail_domains` row ever reaches ACTIVE without
 * that proof (a migration, a support fix applied with psql, a defect), the
 * panel's checks are already behind us, and these queries are what still stands
 * between that row and one company's mail reaching a stranger.
 *
 * Testing the SQL by reading it proves nothing: a query that silently matches
 * one row too many looks correct on the page. So the real map files are
 * rendered with real credentials into a temporary directory and handed to the
 * real `postmap`.
 */
describe('postfix lookup maps', () => {
  const prisma = new PrismaClient() as PrismaService;
  const suffix = Date.now().toString(36);

  const ACTIVE = `active-${suffix}.test`;
  const PENDING = `pending-${suffix}.test`;
  const SUSPENDED = `suspended-${suffix}.test`;

  let configDir: string;
  let postmapAvailable = false;
  let customerId: string;

  /** Renders a `.cf.example` with this machine's credentials, into a temp dir. */
  const render = async (name: string, credentials: URL): Promise<string> => {
    const source = await readFile(
      join(__dirname, '..', '..', 'mail', 'postfix', `${name}.cf.example`),
      'utf8',
    );

    const rendered = source
      .replace(/^hosts = .*$/m, `hosts = ${credentials.hostname}:${credentials.port || '5432'}`)
      .replace(/^user = .*$/m, `user = ${decodeURIComponent(credentials.username)}`)
      .replace(/^password = .*$/m, `password = ${decodeURIComponent(credentials.password)}`)
      .replace(/^dbname = .*$/m, `dbname = ${credentials.pathname.replace(/^\//, '')}`);

    const path = join(configDir, `${name}.cf`);
    await writeFile(path, rendered, { mode: 0o600 });
    return path;
  };

  /** `postmap -q` prints the value, or exits non-zero when nothing matches. */
  const lookup = async (mapPath: string, key: string): Promise<string[]> => {
    try {
      const { stdout } = await run('postmap', ['-q', key, `pgsql:${mapPath}`]);
      return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  };

  let domainsMap: string;
  let mailboxMap: string;
  let aliasMap: string;
  let catchAllMap: string;

  beforeAll(async () => {
    await prisma.$connect();

    try {
      await run('postmap', ['-q', 'x', 'static:y']);
      postmapAvailable = true;
    } catch {
      postmapAvailable = false;
    }

    configDir = await mkdtemp(join(tmpdir(), 'webedge-maps-'));
    const credentials = new URL(process.env.DATABASE_URL ?? '');

    if (postmapAvailable) {
      domainsMap = await render('pgsql-virtual-mailbox-domains', credentials);
      mailboxMap = await render('pgsql-virtual-mailbox-maps', credentials);
      aliasMap = await render('pgsql-virtual-alias-maps', credentials);
      catchAllMap = await render('pgsql-virtual-alias-catchall', credentials);
    }

    const customer = await prisma.customer.create({
      data: { fullName: 'Maps Co', email: `maps-${suffix}@isolation.test`, status: 'ACTIVE' },
    });
    customerId = customer.id;

    const passwordHash = await hashMailboxPassword('a-long-enough-password');

    const make = async (name: string, status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED') =>
      prisma.mailDomain.create({
        data: {
          customerId,
          name,
          status,
          verifiedAt: status === 'ACTIVE' ? new Date() : null,
          verificationToken: MailDomainsService.newToken(),
          mailboxes: {
            create: [
              { localPart: 'asha', passwordHash, quotaMib: 2048 },
              { localPart: 'dormant', passwordHash, isActive: false },
            ],
          },
          aliases: {
            create: [
              { localPart: 'sales', destinations: [`asha@${name}`, 'outside@elsewhere.test'] },
              { localPart: 'retired', destinations: [`asha@${name}`], isActive: false },
              { localPart: '*', destinations: [`asha@${name}`] },
            ],
          },
        },
      });

    await make(ACTIVE, 'ACTIVE');
    await make(PENDING, 'PENDING_VERIFICATION');
    await make(SUSPENDED, 'SUSPENDED');
  });

  afterAll(async () => {
    await prisma.mailDomain.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.$disconnect();
  });

  it('is being checked against a real postmap', () => {
    expect(
      postmapAvailable,
      'postfix and postfix-pgsql are not installed, so nothing here proved the queries work',
    ).toBe(true);
  });

  describe('which domains accept mail', () => {
    it('accepts a verified domain', async () => {
      expect(await lookup(domainsMap, ACTIVE)).toEqual(['1']);
    });

    /**
     * The check that matters. Ownership has not been proved, so mail for this
     * domain must be refused by the mail server itself — not only by the panel,
     * which is not what accepts the connection.
     */
    it('refuses a domain whose ownership has not been proved', async () => {
      expect(await lookup(domainsMap, PENDING)).toEqual([]);
    });

    it('refuses a suspended domain', async () => {
      expect(await lookup(domainsMap, SUSPENDED)).toEqual([]);
    });

    it('refuses a domain that does not exist', async () => {
      expect(await lookup(domainsMap, `nothing-${suffix}.test`)).toEqual([]);
    });
  });

  describe('which addresses have a mailbox', () => {
    it('returns the maildir path for a live mailbox', async () => {
      expect(await lookup(mailboxMap, `asha@${ACTIVE}`)).toEqual([`${ACTIVE}/asha/`]);
    });

    it('refuses a mailbox that has been switched off', async () => {
      expect(await lookup(mailboxMap, `dormant@${ACTIVE}`)).toEqual([]);
    });

    /**
     * The mailbox row says nothing about its domain's state, so without the join
     * a mailbox on an unverified domain would keep receiving mail.
     */
    it("refuses a mailbox whose domain has not proved ownership", async () => {
      expect(await lookup(mailboxMap, `asha@${PENDING}`)).toEqual([]);
    });

    it('refuses a mailbox on a suspended domain', async () => {
      expect(await lookup(mailboxMap, `asha@${SUSPENDED}`)).toEqual([]);
    });

    it('refuses an address with no mailbox', async () => {
      expect(await lookup(mailboxMap, `nobody@${ACTIVE}`)).toEqual([]);
    });
  });

  describe('forwarding', () => {
    /**
     * Postfix's pgsql client concatenates the result rows with commas before
     * handing them to virtual_alias_maps, which is the comma-separated list that
     * map expects. Asserted on the real output rather than on what the query
     * looks like it should produce — running `postmap -q` is what showed the
     * joining happens at all.
     *
     * The join is only safe because an address cannot contain a comma: RFC 5321
     * allows one inside a quoted local part, and `mail-address.ts` refuses
     * quoted local parts at creation. Without that, a destination would split
     * into two addresses here.
     */
    it('returns the destinations as the comma-separated list Postfix expects', async () => {
      const [result, ...rest] = await lookup(aliasMap, `sales@${ACTIVE}`);

      expect(rest, 'postfix returns one joined value, not a row each').toEqual([]);
      expect(result!.split(',').sort()).toEqual(
        [`asha@${ACTIVE}`, 'outside@elsewhere.test'].sort(),
      );
      // No stray whitespace: Postfix splits this list on commas and would carry
      // a leading space into the address.
      expect(result).not.toContain(' ');
    });

    it('refuses an alias that has been switched off', async () => {
      expect(await lookup(aliasMap, `retired@${ACTIVE}`)).toEqual([]);
    });

    it('refuses an alias on an unverified domain', async () => {
      expect(await lookup(aliasMap, `sales@${PENDING}`)).toEqual([]);
    });

    /**
     * The catch-all is a separate map queried second, so a named alias always
     * wins. In one query the precedence would depend on row order, which nothing
     * guarantees.
     */
    it('does not answer a named address from the catch-all map', async () => {
      const named = await lookup(aliasMap, `anything-at-all@${ACTIVE}`);
      expect(named, 'the named map must miss so Postfix falls through').toEqual([]);

      const caught = await lookup(catchAllMap, `anything-at-all@${ACTIVE}`);
      expect(caught).toEqual([`asha@${ACTIVE}`]);
    });

    it('does not catch anything for an unverified domain', async () => {
      expect(await lookup(catchAllMap, `anything@${PENDING}`)).toEqual([]);
    });
  });

  describe('the rendered config', () => {
    /** A password in git is a password that has leaked. */
    it('ships an example with no real credentials in it', async () => {
      const source = await readFile(
        join(__dirname, '..', '..', 'mail', 'postfix', 'pgsql-virtual-mailbox-maps.cf.example'),
        'utf8',
      );

      expect(source).toContain('password = CHANGE_ME');
      const credentials = new URL(process.env.DATABASE_URL ?? '');
      expect(source).not.toContain(decodeURIComponent(credentials.password));
    });
  });
});
