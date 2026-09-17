import { resolve } from 'node:path';
import { InstallState } from './lock';
import { portIsFree } from './environment';
import { startSetupServer } from './server';

/**
 * `npm run install:wizard`.
 *
 * Starting from a shell is the authentication. There is no administrator yet, so
 * the only thing that can be proved is access to this machine — and running this
 * command is that proof. The token it prints is how the browser inherits it.
 *
 * Bound to loopback by default. `--host` exposes it, and says what that means
 * rather than quietly doing it: for as long as installation takes, an
 * unauthenticated endpoint that writes the database connection and creates an
 * administrator is reachable from wherever that interface reaches.
 */

const BOLD = '[1m';
const DIM = '[2m';
const RESET = '[0m';
const RED = '[31m';
const GREEN = '[32m';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const backendDir = resolve(__dirname, '..', '..');
  const repoRoot = resolve(backendDir, '..');
  const stateDir = resolve(backendDir, '.webedge');

  const state = new InstallState(stateDir);
  const installed = await state.read();

  if (installed) {
    console.error(`\n${RED}WebEdge is already installed.${RESET}`);
    console.error(`  Installed:  ${new Date(installed.installedAt).toUTCString()}`);
    console.error(`  Admin:      ${installed.adminEmail}`);
    console.error(
      `\n  The wizard stays closed afterwards — it can repoint the database and create\n` +
        `  an administrator. To reinstall deliberately, remove the lock yourself:\n\n` +
        `    ${BOLD}rm ${state.lockPath}${RESET}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const host = arg('host', '127.0.0.1');
  const port = Number(arg('port', '4500'));

  if (!(await portIsFree(port, host))) {
    console.error(`\n${RED}Port ${port} on ${host} is already in use.${RESET}`);
    console.error(`  Pick another: ${BOLD}npm run install:wizard -- --port 4600${RESET}\n`);
    process.exitCode = 1;
    return;
  }

  const server = await startSetupServer({ port, host, paths: { backendDir, stateDir, repoRoot } });

  console.log(`\n${BOLD}WebEdge installer${RESET}`);
  console.log(`\n  Open       ${GREEN}${server.url}${RESET}`);
  console.log(`  Token      ${BOLD}${server.token}${RESET}`);
  console.log(`${DIM}             (also at ${state.tokenPath})${RESET}`);

  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.log(
      `\n  ${RED}Listening on ${host}, not just this machine.${RESET}\n` +
        `  ${DIM}Until installation finishes, anyone who can reach that address and read\n` +
        `  the token can configure this deployment. Close it as soon as you are done.${RESET}`,
    );
  }

  if (await state.tokenIsExposed()) {
    console.log(`\n  ${RED}The token file is readable by other accounts on this machine.${RESET}`);
  }

  console.log(`\n${DIM}  Ctrl-C to stop. The installer closes itself once installation succeeds.${RESET}\n`);

  const shutdown = async (): Promise<void> => {
    await server.close();
    // The token is only useful while this process is listening. Leaving it on
    // disk after an abandoned run is a credential nobody remembers writing.
    await state.revokeToken();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main().catch((error: unknown) => {
  console.error(`\n${RED}The installer could not start.${RESET}`);
  console.error(`  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
