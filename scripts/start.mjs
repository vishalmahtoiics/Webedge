#!/usr/bin/env node
/**
 * Runs the API and the portal as one application.
 *
 * WebEdge is two programs: a NestJS API and a Next.js portal. Deploying them as
 * two applications is the cleaner arrangement and `DEPLOY.md` describes it — but
 * it needs a second resource, a second domain, matching CORS origins and an
 * API base URL, and getting any one of them wrong produces a page that loads
 * and then fails, or a domain that answers 404 with no clue why.
 *
 * This entry point collapses all of that. One container, one port, one domain:
 *
 *   browser ──► Next.js (public port) ──► NestJS (127.0.0.1, internal only)
 *
 * The API is not published. Nothing outside the container can reach it, the
 * browser never addresses it, and because every call to it is made server-side
 * by Next.js there is no cross-origin request anywhere — so CLIENT_ORIGIN and
 * ADMIN_ORIGIN stop mattering, which is one whole class of silent failure gone.
 *
 * Both processes share a lifetime. If either exits, this kills the other and
 * exits non-zero, so the platform restarts a whole container rather than
 * leaving half a system answering requests it cannot serve.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The port the platform routes to. Next.js takes it; the API never does. */
const PUBLIC_PORT = Number(process.env.PORT ?? 3000);
/**
 * The API's port, bound to loopback. Moved out of the way if the platform
 * happens to hand us the same number, which would otherwise be a startup race
 * whose loser reports "address in use" and whose winner is arbitrary.
 */
const INTERNAL_API_PORT = Number(process.env.INTERNAL_API_PORT ?? 4000) === PUBLIC_PORT
  ? PUBLIC_PORT + 1
  : Number(process.env.INTERNAL_API_PORT ?? 4000);

const children = new Map();
let shuttingDown = false;

function run(name, command, args, options) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  children.set(name, child);

  child.on('exit', (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;
    console.error(`[start] ${name} exited (${signal ?? `code ${code}`}). Stopping the rest.`);
    stop(code === 0 ? 1 : (code ?? 1));
  });

  return child;
}

function stop(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [, child] of children) child.kill('SIGTERM');
  // Long enough for a clean shutdown, short enough that a stuck process does
  // not hold a redeploy open.
  setTimeout(() => {
    for (const [, child] of children) child.kill('SIGKILL');
    process.exit(exitCode);
  }, 5000).unref();
  setTimeout(() => process.exit(exitCode), 500).unref();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => stop(0));
}

/** Resolves once the API answers, or rejects with something worth reading. */
async function waitForApi(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shuttingDown) throw new Error('Shutting down before the API came up.');
    try {
      // Any answer means it is listening. A 401 is a perfectly good answer:
      // the route exists and refused us, which is exactly what it should do.
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`The API did not start within ${timeoutMs / 1000}s.`);
}

async function main() {
  console.log('[start] Applying database migrations…');
  const migrate = spawn('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: join(root, 'backend'),
    stdio: 'inherit',
  });
  const [migrateCode] = await once(migrate, 'exit');
  if (migrateCode !== 0) {
    // Nothing below can work against a schema that does not match, and failing
    // here names the cause. Starting anyway would fail on the first request,
    // where it reads as a bug in the application.
    console.error('[start] Migrations failed. Not starting.');
    process.exit(1);
  }

  console.log(`[start] API on 127.0.0.1:${INTERNAL_API_PORT} (not published)`);
  run('api', 'node', ['dist/main.js'], {
    cwd: join(root, 'backend'),
    env: { ...process.env, PORT: String(INTERNAL_API_PORT), HOST: '127.0.0.1' },
  });

  await waitForApi(`http://127.0.0.1:${INTERNAL_API_PORT}/api/v1`);
  console.log('[start] API is up.');

  console.log(`[start] Portal on 0.0.0.0:${PUBLIC_PORT}`);
  run('portal', 'npx', ['next', 'start', '-H', '0.0.0.0', '-p', String(PUBLIC_PORT)], {
    cwd: join(root, 'frontend'),
    env: {
      ...process.env,
      PORT: String(PUBLIC_PORT),
      // Loopback, so this never leaves the container and never becomes a
      // cross-origin request.
      API_BASE_URL: `http://127.0.0.1:${INTERNAL_API_PORT}/api/v1`,
    },
  });
}

main().catch((error) => {
  console.error(`[start] ${error instanceof Error ? error.message : String(error)}`);
  stop(1);
});
