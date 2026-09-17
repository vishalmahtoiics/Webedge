import { PrismaClient } from '@prisma/client';
import { canWrite, detectEnvironment, satisfiesMinimum } from './environment';
import { InstallState } from './lock';
import { buildDatabaseUrl } from './env-file';

/**
 * The checks run before anything is written, and again after.
 *
 * Every failure answers four questions, because a setup wizard that says
 * "Installation failed" has handed the problem back unsolved:
 *
 *   - what exactly failed
 *   - why, as far as can be determined
 *   - what to do about it
 *   - whether retrying is worth it
 *
 * A check is either blocking or advisory. Blocking means installation cannot
 * proceed; advisory means it can, with a consequence worth knowing. Nothing is
 * silently ignored, and nothing blocks that does not have to — an installer that
 * refuses to run on a machine that would have worked is its own kind of failure.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';

export type CheckResult = {
  id: string;
  title: string;
  status: CheckStatus;
  /** What was found. Present on every result, including the ones that passed. */
  detail: string;
  /** Why it failed, when that is knowable. */
  reason?: string;
  /** What the operator should do. Required whenever the status is not `pass`. */
  action?: string;
  /** Whether trying again, unchanged, could plausibly succeed. */
  retryable?: boolean;
};

/** Node 22 is what the codebase is built and tested against. */
export const MINIMUM_NODE = '22.0.0';
/** Postgres 14 brought the behaviour the migrations rely on. */
export const MINIMUM_POSTGRES = '14.0';

export type DatabaseTarget = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

/**
 * Connects, and turns the failure into something a person can act on.
 *
 * Through Prisma rather than a raw driver, for two reasons. It adds no
 * dependency — Prisma carries its own engine and is already here. And it tests
 * the connection the application will actually make: a check that succeeds over
 * a different client and then fails at boot has told the operator nothing.
 *
 * Prisma reports a wrong password, an unreachable host and a missing database
 * with distinct codes, and the codes are the useful part. The raw message alone
 * gives "authentication failed" with no indication of which field on the form is
 * wrong.
 */
export async function checkDatabase(target: DatabaseTarget): Promise<CheckResult> {
  const base = { id: 'database', title: 'Database connection' };
  const url = buildDatabaseUrl(target);
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });

  try {
    const rows = await prisma.$queryRaw<Array<{ version: string; current_user: string }>>`
      SELECT version() AS version, current_user
    `;
    const version = /PostgreSQL (\d+\.\d+)/.exec(rows[0]?.version ?? '')?.[1];

    // Whether this user can create objects decides whether migrations will
    // work, and finding out now beats finding out halfway through one.
    const privilege = await prisma.$queryRaw<Array<{ allowed: boolean }>>`
      SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS allowed
    `;

    if (!privilege[0]?.allowed) {
      return {
        ...base,
        status: 'fail',
        detail: `Connected to PostgreSQL ${version ?? 'of unknown version'} as ${rows[0]?.current_user}.`,
        reason: 'That user cannot create objects in the database, so migrations would fail.',
        action: `Grant it: GRANT CREATE ON DATABASE "${target.database}" TO "${target.user}";`,
        retryable: true,
      };
    }

    if (version && !satisfiesMinimum(version, MINIMUM_POSTGRES)) {
      return {
        ...base,
        status: 'fail',
        detail: `PostgreSQL ${version}.`,
        reason: `WebEdge needs PostgreSQL ${MINIMUM_POSTGRES} or newer.`,
        action: 'Upgrade the server, or point the installer at a newer one.',
        retryable: false,
      };
    }

    return {
      ...base,
      status: 'pass',
      detail: `PostgreSQL ${version ?? 'connected'}, as ${rows[0]?.current_user}, with permission to create tables.`,
    };
  } catch (error) {
    return { ...base, ...explainDatabaseError(error, target) };
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

/**
 * Turns a connection failure into advice.
 *
 * Prisma's `PrismaClientInitializationError` carries an `errorCode` property —
 * and in the version here it is present as a key and never populated. The
 * distinction between a wrong password, an unreachable host and a missing
 * database exists only in the message text, so that is what is matched, with the
 * code still preferred in case a later version fills it in.
 *
 * Matching on message text is fragile and worth saying so: an upstream rewording
 * degrades this to the generic case, which is still a usable error rather than a
 * wrong one. The alternative — passing Prisma's message straight through — is
 * not available, because that message can carry the connection string, and the
 * connection string carries the password.
 */
export function explainDatabaseError(
  error: unknown,
  target: DatabaseTarget,
): Omit<CheckResult, 'id' | 'title'> {
  const where = `${target.host}:${target.port}`;
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { errorCode?: string }).errorCode ?? classifyByMessage(message);

  switch (code) {
    case 'P1000':
      return {
        status: 'fail',
        detail: `The server rejected the credentials for "${target.user}".`,
        reason: 'The server answered, so the host and port are right. The username or password is not.',
        action: 'Check the password. It is the one field here that nothing else can verify for you.',
        retryable: true,
      };
    case 'P1001':
      return {
        status: 'fail',
        detail: `Nothing answered at ${where}.`,
        reason: 'The database server is not running there, the port is wrong, or a firewall is dropping the connection.',
        action: `Start PostgreSQL, or correct the host and port. From this machine: psql -h ${target.host} -p ${target.port} -U ${target.user}`,
        retryable: true,
      };
    case 'P1002':
      return {
        status: 'fail',
        detail: `${where} accepted the connection but did not finish answering.`,
        reason: 'The server is reachable but overloaded, or something between here and there is stalling.',
        action: 'Try again in a moment. If it keeps happening, check the load on the database server.',
        retryable: true,
      };
    case 'P1003':
      return {
        status: 'fail',
        detail: `The database "${target.database}" does not exist.`,
        reason: 'The server answered and accepted the credentials, so only the database name is wrong.',
        action: `Create it: CREATE DATABASE "${target.database}" OWNER "${target.user}";`,
        retryable: true,
      };
    case 'P1010':
      return {
        status: 'fail',
        detail: `"${target.user}" was denied access to "${target.database}".`,
        reason: 'The credentials are right; the user has no rights on that database.',
        action: `Grant them: GRANT ALL PRIVILEGES ON DATABASE "${target.database}" TO "${target.user}";`,
        retryable: true,
      };
    default:
      return {
        status: 'fail',
        detail: `Could not connect to ${where}.`,
        // Deliberately not the driver's message: it can embed the connection
        // string, and the connection string embeds the password.
        reason: code
          ? `The database driver reported ${code}.`
          : 'The database driver did not say which part of the connection failed.',
        action: 'Check the host, port, database name and credentials against the server.',
        retryable: true,
      };
  }
}

/**
 * The phrases Prisma actually produces, mapped to the codes it documents.
 *
 * Confirmed against this version by connecting wrongly on purpose, not read
 * from the documentation — the documented `errorCode` is never populated here.
 */
function classifyByMessage(message: string): string | undefined {
  if (/Authentication failed against database server/i.test(message)) return 'P1000';
  if (/Can't reach database server/i.test(message)) return 'P1001';
  if (/does not exist/i.test(message) && /Database/i.test(message)) return 'P1003';
  if (/Timed out/i.test(message)) return 'P1002';
  if (/denied access/i.test(message)) return 'P1010';
  return undefined;
}

/** The checks that need nothing but this machine. */
export async function checkEnvironment(paths: {
  backendDir: string;
  stateDir: string;
}): Promise<CheckResult[]> {
  const report = await detectEnvironment();
  const results: CheckResult[] = [];

  results.push(
    satisfiesMinimum(report.node.version ?? '0', MINIMUM_NODE)
      ? {
          id: 'node',
          title: 'Node.js',
          status: 'pass',
          detail: `Node ${report.node.version} on ${report.host.label} (${report.host.arch}).`,
        }
      : {
          id: 'node',
          title: 'Node.js',
          status: 'fail',
          detail: `Node ${report.node.version}.`,
          reason: `WebEdge is built and tested on Node ${MINIMUM_NODE} and newer.`,
          action: `Install Node ${MINIMUM_NODE}+ and run the installer again with it.`,
          retryable: false,
        },
  );

  for (const [id, title, directory, consequence] of [
    ['write-config', 'Writing configuration', paths.backendDir, 'the .env file cannot be written'],
    ['write-state', 'Writing install state', paths.stateDir, 'the install lock cannot be written'],
  ] as const) {
    const write = await canWrite(directory);
    results.push(
      write.writable
        ? { id, title, status: 'pass', detail: `${directory} is writable.` }
        : {
            id,
            title,
            status: 'fail',
            detail: `${directory} cannot be written to.`,
            reason: `${write.reason} — so ${consequence}.`,
            action: `Give the account running the installer write access: chown -R $(whoami) ${directory}`,
            retryable: true,
          },
    );
  }

  // Advisory. Prisma runs migrations through its own engine, so psql is only
  // needed by an operator doing something by hand — saying so is better than
  // blocking an install that would have worked.
  results.push(
    report.psql.present
      ? {
          id: 'psql',
          title: 'PostgreSQL client tools',
          status: 'pass',
          detail: `psql ${report.psql.version} is available.`,
        }
      : {
          id: 'psql',
          title: 'PostgreSQL client tools',
          status: 'warn',
          detail: 'psql was not found on PATH.',
          reason: 'Migrations do not need it — Prisma carries its own engine.',
          action: 'Install postgresql-client if you want to inspect the database by hand later.',
        },
  );

  if (report.host.containerised) {
    results.push({
      id: 'container',
      title: 'Container',
      status: 'warn',
      detail: 'Running inside a container.',
      reason: 'Anything written outside a mounted volume is lost when the container is replaced.',
      action: 'Make sure the .env file and install lock are on a volume that survives a restart.',
    });
  }

  return results;
}

/** The last gate before the wizard opens at all. */
export async function checkNotAlreadyInstalled(state: InstallState): Promise<CheckResult> {
  const record = await state.read();

  if (!record) {
    return {
      id: 'not-installed',
      title: 'Installation state',
      status: 'pass',
      detail: 'No previous installation found.',
    };
  }

  return {
    id: 'not-installed',
    title: 'Installation state',
    status: 'fail',
    detail: `WebEdge was installed on ${new Date(record.installedAt).toUTCString()}.`,
    reason: 'The setup wizard stays closed afterwards: it can repoint the database and create an administrator.',
    action: `To reinstall deliberately, remove ${state.lockPath} from a shell on this server and run the installer again.`,
    retryable: false,
  };
}

export const isBlocking = (results: CheckResult[]): boolean =>
  results.some((result) => result.status === 'fail');
