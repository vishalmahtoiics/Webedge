import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Installer, type InstallRequest } from './install';
import { InstallState } from './lock';
import { checkDatabase, checkEnvironment, checkNotAlreadyInstalled } from './preflight';
import { checkPassword, describePasswordProblem, generatePassword } from './secrets';
import { detectEnvironment } from './environment';
import { UnsafeEnvValueError } from './env-file';

/**
 * The setup server.
 *
 * Deliberately not part of the application. The application refuses to boot
 * without a valid configuration, which is the file this wizard exists to write —
 * so the two cannot be the same process, and a route inside the API that runs
 * before configuration is loaded would be a hole in the API's own guarantees.
 *
 * Three rules hold every request:
 *
 *  - **It binds to the loopback interface by default.** An installer listening
 *    on every interface is an unauthenticated setup endpoint reachable from the
 *    internet for as long as installation takes. Exposing it is possible, and
 *    requires saying so out loud.
 *  - **Every request carries the setup token**, which was printed to the
 *    terminal of whoever started the installer. Before an administrator exists,
 *    proof of access to the machine is the only authentication available.
 *  - **Every request re-checks the lock**, from disk. Not once at startup: the
 *    lock is written by this same process mid-session, and a cached answer would
 *    keep the wizard open after it closed.
 */

export type ServerOptions = {
  port: number;
  host: string;
  paths: { backendDir: string; stateDir: string; repoRoot: string };
};

type Json = Record<string, unknown>;

const MAX_BODY_BYTES = 64 * 1024;

export async function startSetupServer(options: ServerOptions): Promise<{
  url: string;
  token: string;
  close: () => Promise<void>;
}> {
  const state = new InstallState(options.paths.stateDir);
  await state.assertNotInstalled();

  const token = await state.issueToken();
  const installer = new Installer(options.paths, state);
  const wizard = await readFile(join(__dirname, 'wizard.html'), 'utf8');

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      send(res, 500, {
        error: {
          detail: 'The installer hit an unexpected problem.',
          reason: error instanceof Error ? error.message : String(error),
          action: 'Check the installer output in your terminal, then try again.',
          retryable: true,
        },
      });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // The page itself carries no data and needs no token: it is a form that
    // cannot do anything until one is supplied.
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        // Nothing here should be cached, framed or sent anywhere.
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
      });
      res.end(wizard);
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      send(res, 404, { error: { detail: 'Not found.' } });
      return;
    }

    // Read from disk every time. The lock is written by this process partway
    // through a session, and a value read once at startup would keep the wizard
    // open after it had closed.
    if (await state.isInstalled()) {
      const record = await state.read();
      send(res, 409, {
        error: {
          detail: `WebEdge was installed on ${new Date(record!.installedAt).toUTCString()}.`,
          reason: 'The setup wizard closes permanently once installation succeeds.',
          action: `To reinstall deliberately, remove ${state.lockPath} from a shell on this server.`,
          retryable: false,
        },
      });
      return;
    }

    const supplied = req.headers['x-setup-token'];
    if (typeof supplied !== 'string' || !(await state.verifyToken(supplied))) {
      send(res, 401, {
        error: {
          detail: 'That setup token is not the one this installer issued.',
          reason: 'The token proves you have access to this server, which is the only thing that can be proved before an administrator exists.',
          action: `Copy it from the terminal running the installer, or from ${state.tokenPath}.`,
          retryable: true,
        },
      });
      return;
    }

    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/environment': {
        const [environment, checks, notInstalled] = await Promise.all([
          detectEnvironment(),
          checkEnvironment(options.paths),
          checkNotAlreadyInstalled(state),
        ]);
        send(res, 200, {
          environment,
          checks: [notInstalled, ...checks],
          suggestedPassword: generatePassword(),
        });
        return;
      }

      case 'POST /api/check-database': {
        const body = await readJson(req);
        const target = {
          host: String(body.host ?? '127.0.0.1'),
          port: Number(body.port ?? 5432),
          database: String(body.database ?? ''),
          user: String(body.user ?? ''),
          password: String(body.password ?? ''),
        };
        send(res, 200, { check: await checkDatabase(target) });
        return;
      }

      case 'POST /api/install': {
        const body = await readJson(req);
        const request = parseInstallRequest(body);
        if ('error' in request) {
          send(res, 422, { error: request.error });
          return;
        }

        try {
          const outcome = await installer.run(request.value);
          send(res, outcome.ok ? 200 : 422, outcome as unknown as Json);
        } catch (error) {
          if (error instanceof UnsafeEnvValueError) {
            send(res, 422, {
              error: {
                detail: `${error.key} cannot be stored in a configuration file.`,
                reason: error.message,
                action: 'Change that value and try again.',
                retryable: true,
              },
            });
            return;
          }
          throw error;
        }
        return;
      }

      default:
        send(res, 404, { error: { detail: 'Not found.' } });
    }
  }

  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));

  return {
    url: `http://${options.host}:${options.port}/`,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function send(res: ServerResponse, status: number, body: Json): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Bounded: an installer is not a place to accept an unbounded upload. */
async function readJson(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.');
    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
}

/**
 * Validates the form.
 *
 * Every rejection names the field, so the wizard can point at it rather than
 * showing a sentence above a form of eleven inputs.
 */
function parseInstallRequest(
  body: Json,
): { value: InstallRequest } | { error: { field?: string; detail: string; action: string; retryable: boolean } } {
  const fail = (field: string, detail: string, action: string) => ({
    error: { field, detail, action, retryable: true },
  });

  const database = (body.database ?? {}) as Json;
  const admin = (body.admin ?? {}) as Json;
  const application = (body.application ?? {}) as Json;
  const seed = (body.seed ?? {}) as Json;

  const host = String(database.host ?? '').trim();
  const database_ = String(database.database ?? '').trim();
  const user = String(database.user ?? '').trim();
  const password = String(database.password ?? '');
  const port = Number(database.port ?? 5432);

  if (!host) return fail('database.host', 'The database host is required.', 'Use 127.0.0.1 for a database on this machine.');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return fail('database.port', 'The database port must be a number between 1 and 65535.', 'PostgreSQL usually listens on 5432.');
  }
  if (!database_) return fail('database.database', 'The database name is required.', 'Name the database WebEdge should use.');
  if (!user) return fail('database.user', 'The database user is required.', 'Give the user WebEdge connects as.');

  const email = String(admin.email ?? '').trim().toLowerCase();
  const fullName = String(admin.fullName ?? '').trim();
  const adminPassword = String(admin.password ?? '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return fail('admin.email', 'Enter a valid email address for the administrator.', 'This is the address you will sign in with.');
  }
  if (fullName.length < 2) {
    return fail('admin.fullName', "The administrator's name is required.", 'It appears in the audit trail beside everything this account does.');
  }

  const problem = checkPassword(adminPassword);
  if (problem) {
    return fail('admin.password', describePasswordProblem(problem), 'Pick a different password, or use the generated one.');
  }

  const nodeEnv = String(application.nodeEnv ?? 'production');
  if (!['development', 'staging', 'production'].includes(nodeEnv)) {
    return fail('application.nodeEnv', 'Choose development, staging or production.', 'Production is the right answer for a real deployment.');
  }

  for (const [field, value] of [
    ['application.clientOrigin', application.clientOrigin],
    ['application.adminOrigin', application.adminOrigin],
  ] as const) {
    try {
      // eslint-disable-next-line no-new
      new URL(String(value ?? ''));
    } catch {
      return fail(field, 'That is not a valid URL.', 'Include the scheme, for example https://panel.example.com.');
    }
  }

  const appPort = Number(application.port ?? 4000);
  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65_535) {
    return fail('application.port', 'The application port must be a number between 1 and 65535.', 'The default is 4000.');
  }

  return {
    value: {
      database: { host, port, database: database_, user, password, schema: 'public' },
      admin: { email, fullName, password: adminPassword },
      application: {
        clientOrigin: String(application.clientOrigin),
        adminOrigin: String(application.adminOrigin),
        port: appPort,
        nodeEnv: nodeEnv as InstallRequest['application']['nodeEnv'],
      },
      seed: {
        schema: seed.schema !== false,
        referenceData: seed.referenceData !== false,
        demoData: seed.demoData === true,
      },
    },
  };
}
