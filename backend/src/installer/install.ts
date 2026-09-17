import { execFile } from 'node:child_process';
import { chmod, copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { buildDatabaseUrl, redactEnv, renderEnvFile, type EnvSection } from './env-file';
import { InstallState, type InstallRecord } from './lock';
import { pathExists } from './environment';
import { checkDatabase, type CheckResult, type DatabaseTarget } from './preflight';
import { generateEncryptionKey, generateSigningSecret } from './secrets';

const run = promisify(execFile);

/**
 * Doing the installation.
 *
 * Ordered so that the irreversible things happen last and the recoverable ones
 * first. Configuration is written, then migrations run, then data is seeded,
 * then the administrator is created, and only then is the lock written. An
 * install that fails at the fourth step leaves a database and a `.env` that can
 * be retried; one that wrote the lock first would leave a half-installed system
 * with the wizard already closed.
 */

export type InstallRequest = {
  database: DatabaseTarget & { schema?: string };
  admin: { email: string; fullName: string; password: string };
  application: {
    clientOrigin: string;
    adminOrigin: string;
    port: number;
    nodeEnv: 'development' | 'staging' | 'production';
  };
  seed: {
    /** Run migrations. Off means the schema already exists. */
    schema: boolean;
    /** Roles, permissions and the starting plan catalogue. */
    referenceData: boolean;
    /** Example customers and content, for evaluating the panel. */
    demoData: boolean;
  };
};

export type StepResult = {
  id: string;
  title: string;
  status: 'done' | 'skipped' | 'failed';
  detail: string;
  reason?: string;
  action?: string;
  retryable?: boolean;
};

export type InstallOutcome = {
  ok: boolean;
  steps: StepResult[];
  /** Shown once on the final screen and never stored anywhere. */
  adminPassword?: string;
  /** What was written, with secrets replaced. Safe to display. */
  configuration?: Record<string, string>;
};

export class Installer {
  constructor(
    private readonly paths: { backendDir: string; stateDir: string; repoRoot: string },
    private readonly state: InstallState,
  ) {}

  private get envPath(): string {
    return join(this.paths.backendDir, '.env');
  }

  /**
   * Runs the whole thing, stopping at the first failure.
   *
   * Stopping rather than continuing: every step after a failed one depends on
   * it, and a list of five cascading errors hides which one actually mattered.
   */
  async run(request: InstallRequest): Promise<InstallOutcome> {
    const steps: StepResult[] = [];

    // Nothing at all happens if the lock is already there, checked again here
    // rather than trusting the route that let the request through.
    await this.state.assertNotInstalled();

    const databaseUrl = buildDatabaseUrl(request.database);
    let configuration: Record<string, string> | undefined;

    const sequence: Array<() => Promise<StepResult>> = [
      async () => this.verifyDatabase(request.database),
      async () => {
        const written = await this.writeConfiguration(request, databaseUrl);
        configuration = redactEnv(written.values);
        return written.step;
      },
      async () => this.runMigrations(request, databaseUrl),
      async () => this.seedReferenceData(request, databaseUrl),
      async () => this.createAdministrator(request, databaseUrl),
      async () => this.seedDemoData(request, databaseUrl),
    ];

    for (const step of sequence) {
      const result = await step();
      steps.push(result);
      if (result.status === 'failed') {
        return { ok: false, steps, configuration };
      }
    }

    steps.push(await this.finalise(request));

    return {
      ok: steps.every((step) => step.status !== 'failed'),
      steps,
      adminPassword: request.admin.password,
      configuration,
    };
  }

  private async verifyDatabase(target: DatabaseTarget): Promise<StepResult> {
    const check: CheckResult = await checkDatabase(target);
    return {
      id: check.id,
      title: check.title,
      status: check.status === 'fail' ? 'failed' : 'done',
      detail: check.detail,
      reason: check.reason,
      action: check.action,
      retryable: check.retryable,
    };
  }

  /**
   * Writes `.env`.
   *
   * An existing file is copied aside rather than overwritten. Someone running
   * the installer on a machine that already has one is either recovering or has
   * made a mistake, and neither is improved by destroying the only copy of their
   * configuration.
   */
  private async writeConfiguration(
    request: InstallRequest,
    databaseUrl: string,
  ): Promise<{ step: StepResult; values: Record<string, string> }> {
    const values: Record<string, string> = {
      NODE_ENV: request.application.nodeEnv,
      PORT: String(request.application.port),
      DATABASE_URL: databaseUrl,
      JWT_ACCESS_SECRET: generateSigningSecret(),
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL_DAYS: '30',
      ADMIN_JWT_REFRESH_TTL_HOURS: '12',
      CREDENTIAL_ENCRYPTION_KEY: generateEncryptionKey(),
      CREDENTIAL_ENCRYPTION_KEY_VERSION: 'v1',
      CLIENT_ORIGIN: request.application.clientOrigin,
      ADMIN_ORIGIN: request.application.adminOrigin,
      // __Host- cookies require Secure, and the config refuses to boot in
      // production without it. Decided from the environment rather than asked,
      // because the only correct answer in production is true.
      COOKIE_SECURE: request.application.nodeEnv === 'development' ? 'false' : 'true',
    };

    const sections: EnvSection[] = [
      {
        title: 'Runtime',
        entries: [
          { key: 'NODE_ENV', value: values.NODE_ENV! },
          { key: 'PORT', value: values.PORT! },
        ],
      },
      {
        title: 'Database',
        entries: [{ key: 'DATABASE_URL', value: values.DATABASE_URL! }],
      },
      {
        title: 'Sessions',
        comment:
          'Rotating JWT_ACCESS_SECRET ends every signed-in session immediately,\nwhich is the fastest way to lock everyone out after a compromise.',
        entries: [
          { key: 'JWT_ACCESS_SECRET', value: values.JWT_ACCESS_SECRET! },
          { key: 'JWT_ACCESS_TTL', value: values.JWT_ACCESS_TTL! },
          { key: 'JWT_REFRESH_TTL_DAYS', value: values.JWT_REFRESH_TTL_DAYS! },
          { key: 'ADMIN_JWT_REFRESH_TTL_HOURS', value: values.ADMIN_JWT_REFRESH_TTL_HOURS! },
        ],
      },
      {
        title: 'Provider credential encryption',
        comment:
          'Encrypts provider API tokens at rest. Lose this key and every stored\ncredential becomes unreadable — back it up somewhere the database is not.',
        entries: [
          { key: 'CREDENTIAL_ENCRYPTION_KEY', value: values.CREDENTIAL_ENCRYPTION_KEY! },
          {
            key: 'CREDENTIAL_ENCRYPTION_KEY_VERSION',
            value: values.CREDENTIAL_ENCRYPTION_KEY_VERSION!,
          },
        ],
      },
      {
        title: 'Origins',
        entries: [
          { key: 'CLIENT_ORIGIN', value: values.CLIENT_ORIGIN! },
          { key: 'ADMIN_ORIGIN', value: values.ADMIN_ORIGIN! },
          { key: 'COOKIE_SECURE', value: values.COOKIE_SECURE! },
        ],
      },
    ];

    try {
      if (await pathExists(this.envPath)) {
        const backup = `${this.envPath}.replaced-${Date.now()}`;
        await copyFile(this.envPath, backup);
        await chmod(backup, 0o600);
      }

      const file = renderEnvFile(
        sections,
        `Generated by the WebEdge installer on ${new Date().toUTCString()}.\nKeep this file out of version control. It is the only copy of the keys below.`,
      );

      await writeFile(this.envPath, file, { mode: 0o600 });
      // Applied explicitly: the mode option is ignored when the file already
      // exists, and a world-readable .env is a world-readable database password.
      await chmod(this.envPath, 0o600);

      return {
        step: {
          id: 'configuration',
          title: 'Configuration',
          status: 'done',
          detail: `Wrote ${this.envPath} with generated session and encryption keys.`,
        },
        values,
      };
    } catch (error) {
      return {
        step: {
          id: 'configuration',
          title: 'Configuration',
          status: 'failed',
          detail: `Could not write ${this.envPath}.`,
          reason: error instanceof Error ? error.message : String(error),
          action: 'Give the account running the installer write access to that directory.',
          retryable: true,
        },
        values,
      };
    }
  }

  private async runMigrations(request: InstallRequest, databaseUrl: string): Promise<StepResult> {
    if (!request.seed.schema) {
      return {
        id: 'migrations',
        title: 'Database schema',
        status: 'skipped',
        detail: 'Left alone, as asked. The schema is expected to exist already.',
      };
    }

    try {
      const { stdout } = await run('npx', ['prisma', 'migrate', 'deploy'], {
        cwd: this.paths.backendDir,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: 300_000,
      });
      // Prisma's wording, taken from its real output rather than guessed:
      // "The following migration(s) have been applied" when it does work,
      // "No pending migrations to apply." when there is none. An earlier guess
      // matched neither and reported a fresh database as already up to date.
      const applied = /following migrations? have been applied/i.test(stdout);
      const count = /(\d+) migrations? found/i.exec(stdout)?.[1];

      return {
        id: 'migrations',
        title: 'Database schema',
        status: 'done',
        detail: applied
          ? `Applied ${count ?? 'the'} migrations — every table is now in place.`
          : 'Already up to date; no migrations needed applying.',
      };
    } catch (error) {
      return {
        id: 'migrations',
        title: 'Database schema',
        status: 'failed',
        detail: 'Migrations did not complete.',
        reason: summariseProcessError(error),
        action:
          'The database is reachable, so this is usually a permissions problem or a partially-migrated database. ' +
          'Check the message above, then try again — migrations are safe to re-run.',
        retryable: true,
      };
    }
  }

  private async seedReferenceData(
    request: InstallRequest,
    databaseUrl: string,
  ): Promise<StepResult> {
    if (!request.seed.referenceData) {
      return {
        id: 'reference-data',
        title: 'Roles and plans',
        status: 'skipped',
        detail: 'Not seeded, as asked.',
      };
    }

    try {
      await run('npm', ['run', 'seed'], {
        cwd: this.paths.backendDir,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          // The seed creates its own administrator when one is absent and prints
          // a generated password. The installer creates that account itself, so
          // the seed is told the address and password it already has — otherwise
          // two admin accounts exist and only one of them has a known password.
          SEED_ADMIN_EMAIL: request.admin.email,
          SEED_ADMIN_NAME: request.admin.fullName,
          SEED_ADMIN_PASSWORD: request.admin.password,
        },
        timeout: 300_000,
      });

      return {
        id: 'reference-data',
        title: 'Roles and plans',
        status: 'done',
        detail: 'Seeded permissions, roles and the starting plan catalogue.',
      };
    } catch (error) {
      return {
        id: 'reference-data',
        title: 'Roles and plans',
        status: 'failed',
        detail: 'Seeding did not complete.',
        reason: summariseProcessError(error),
        action: 'The seed is idempotent, so it is safe to try again once the cause is fixed.',
        retryable: true,
      };
    }
  }

  /**
   * Makes sure the administrator exists with the password that will be shown.
   *
   * The seed creates one when none exists and leaves an existing one alone, so
   * on a database that already had an account the password on the final screen
   * would be wrong. This sets it either way, which makes the screen true.
   */
  private async createAdministrator(
    request: InstallRequest,
    databaseUrl: string,
  ): Promise<StepResult> {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    try {
      const role = await prisma.role.findFirst({
        where: { realm: 'ADMIN', name: 'SUPER_ADMIN' },
      });
      if (!role) {
        return {
          id: 'administrator',
          title: 'Administrator',
          status: 'failed',
          detail: 'The SUPER_ADMIN role does not exist, so no administrator can be created.',
          reason: 'Roles come from the seed, which was skipped or did not finish.',
          action: 'Run the installer again with "Roles and plans" selected.',
          retryable: true,
        };
      }

      const email = request.admin.email.toLowerCase().trim();
      const passwordHash = await argon2.hash(request.admin.password, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      });

      await prisma.adminUser.upsert({
        where: { email },
        update: { passwordHash, status: 'ACTIVE', roleId: role.id, failedLoginCount: 0, lockedUntil: null },
        create: {
          email,
          fullName: request.admin.fullName,
          passwordHash,
          roleId: role.id,
          status: 'ACTIVE',
        },
      });

      return {
        id: 'administrator',
        title: 'Administrator',
        status: 'done',
        // The password is not in here. It is returned separately, shown once,
        // and never written to a file or a log.
        detail: `${email} can sign in to the staff portal.`,
      };
    } catch (error) {
      return {
        id: 'administrator',
        title: 'Administrator',
        status: 'failed',
        detail: 'The administrator account could not be created.',
        reason: error instanceof Error ? error.message : String(error),
        action: 'Check the database is reachable and the schema is up to date, then try again.',
        retryable: true,
      };
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  }

  /**
   * Demo content.
   *
   * Not built. Saying so is the whole point: a step that silently does nothing
   * while reporting success is how someone spends an afternoon looking for
   * sample data that was never going to appear.
   */
  private async seedDemoData(request: InstallRequest, _databaseUrl: string): Promise<StepResult> {
    if (!request.seed.demoData) {
      return {
        id: 'demo-data',
        title: 'Example content',
        status: 'skipped',
        detail: 'Not installed, as asked.',
      };
    }

    return {
      id: 'demo-data',
      title: 'Example content',
      status: 'skipped',
      detail: 'No example content ships yet, so nothing was installed.',
      reason: 'Demo customers and websites are not built. The option is here; the data is not.',
      action: 'Create a customer from the staff portal to try the panel out.',
    };
  }

  /**
   * Closes the installer.
   *
   * The token is revoked and the lock written. `.env` is emphatically kept —
   * the application needs it to start, and an installer that tidies away the
   * configuration it just wrote leaves a deployment that cannot boot.
   */
  private async finalise(request: InstallRequest): Promise<StepResult> {
    const record: InstallRecord = {
      installedAt: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
      seeded: {
        schema: request.seed.schema,
        demoData: request.seed.demoData,
        adminUser: true,
      },
      adminEmail: request.admin.email.toLowerCase().trim(),
    };

    await this.state.revokeToken();
    await this.state.lock(record);

    return {
      id: 'lock',
      title: 'Closing the installer',
      status: 'done',
      detail:
        'Setup token deleted and the installer locked. The configuration file is kept — the application needs it.',
    };
  }
}

/**
 * A child process failure, made readable.
 *
 * Prisma and npm both put the useful part on stderr and then several screens of
 * stack trace after it. The last few non-empty lines are almost always the
 * cause; the whole buffer is almost always noise.
 */
function summariseProcessError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr ?? '';
  const stdout = (error as { stdout?: string }).stdout ?? '';
  const text = `${stderr}\n${stdout}`.trim();

  if (!text) return error instanceof Error ? error.message : String(error);

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    // A connection string reaching a browser would carry the database password
    // with it.
    .filter((line) => !/postgres(ql)?:\/\//i.test(line));

  return lines.slice(-6).join('\n');
}
