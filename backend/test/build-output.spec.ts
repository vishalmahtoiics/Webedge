import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The build must not be able to exit 0 having emitted nothing.
 *
 * Two settings that are each reasonable combine into a silent failure:
 *
 *  - `nest-cli.json` sets `deleteOutDir`, so every build starts from an empty
 *    `dist`.
 *  - `tsconfig.json` sets `incremental`, so tsc consults
 *    `tsconfig.tsbuildinfo` and skips emitting anything it believes is already
 *    written.
 *
 * Nothing tells tsc that its output was deleted. Build twice without touching
 * a source file and the second build removes `dist`, decides there is nothing
 * to do, and leaves `dist` holding only the assets Nest copies — no JavaScript
 * at all. `npm run build` prints success. `npm run install:wizard` then dies
 * with MODULE_NOT_FOUND on `dist/installer/cli.js`, naming a file that is
 * plainly present in `src`, which is the part that costs an hour.
 *
 * Observed, not theorised: `dist/installer/` contained `wizard.html` and
 * nothing else after a successful build, and removing `tsconfig.tsbuildinfo`
 * restored all 304 files.
 *
 * The rule below is over the configuration rather than over today's scripts,
 * so a script added later is covered without anyone remembering this file
 * exists. It is deliberately not a rule against `incremental` — the watcher
 * wants it — but against leaving the build info in place across a build that
 * deletes what the build info describes.
 */

const backendDir = join(__dirname, '..');

const read = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(backendDir, name), 'utf8')) as Record<string, unknown>;

const pkg = read('package.json') as { scripts: Record<string, string> };
const nestCli = read('nest-cli.json') as {
  compilerOptions?: { deleteOutDir?: boolean; assets?: Array<{ include: string; outDir?: string }> };
};
const tsconfig = read('tsconfig.json') as { compilerOptions?: { incremental?: boolean } };

/** Commands that make tsc emit through Nest, and so depend on the build info. */
const COMPILES = /\bnest\s+(build|start)\b/;
/** Removing the build info, however the removal is spelt. */
const CLEARS_BUILD_INFO = /\brm\b[^&|]*tsconfig\.tsbuildinfo\b/;

/**
 * Follows `npm run x` chains, because the clearing usually lives one script
 * deeper than the script being checked.
 */
function expand(script: string, seen = new Set<string>()): string {
  return script.replace(/npm run ([\w:-]+)/g, (match, name: string) => {
    if (seen.has(name)) return match;
    seen.add(name);
    const body = pkg.scripts[name];
    return body ? ` ${expand(body, seen)} ` : match;
  });
}

describe('build output', () => {
  it('has the two settings whose combination this guards', () => {
    // If either is turned off the hazard is gone and the rule below is moot —
    // but silently passing a test that no longer tests anything is worse than
    // failing, so the assumption is stated.
    expect(nestCli.compilerOptions?.deleteOutDir).toBe(true);
    expect(tsconfig.compilerOptions?.incremental).toBe(true);
  });

  it('clears the stale build info in every script that compiles', () => {
    const compiling = Object.entries(pkg.scripts).filter(
      ([name, body]) => !name.startsWith('//') && COMPILES.test(expand(body)),
    );

    expect(compiling.length, 'no script compiles — the rule has nothing to check').toBeGreaterThan(0);

    const unguarded = compiling
      .filter(([, body]) => !CLEARS_BUILD_INFO.test(expand(body)))
      .map(([name]) => name);

    expect(
      unguarded,
      'These scripts run the Nest compiler without first removing tsconfig.tsbuildinfo. ' +
        'Because nest-cli.json deletes dist, tsc will consult build info describing files that ' +
        'no longer exist, emit nothing, and exit 0 — leaving a dist that holds only copied ' +
        'assets. Chain `npm run clean` before the compiler, as build and start:dev do.',
    ).toEqual([]);
  });

  /**
   * The asset that made the empty `dist` visible in the first place. It is
   * copied by path, so a rename in `src` leaves the include matching nothing
   * and Nest says so in neither its output nor its exit code — the installer
   * then starts and fails only when someone opens the wizard page.
   */
  it('copies an installer page that exists in the source tree', () => {
    const assets = nestCli.compilerOptions?.assets ?? [];
    expect(assets.length).toBeGreaterThan(0);

    for (const asset of assets) {
      expect(
        () => readFileSync(join(backendDir, 'src', asset.include)),
        `nest-cli.json copies ${asset.include}, which is not in src`,
      ).not.toThrow();
    }
  });
});

/**
 * What the deployment build needs to be able to see.
 *
 * `.dockerignore` is applied before the Dockerfile runs, so a pattern here can
 * remove a file the builder itself wrote moments earlier. That is not
 * hypothetical: ignoring `.nixpacks` — which looks like generated scratch, and
 * is — failed a deploy at the third layer with `not found` for the nix
 * expression the builder had just generated into it.
 *
 * Listed by what breaks rather than by name alone, because the next person
 * reading a `not found` in a build log is trying to work out which of these
 * patterns did it.
 */
describe('docker build context', () => {
  const ignoreFile = join(backendDir, '.dockerignore');

  /** Whether `.dockerignore` excludes a path, honouring `!` negations. */
  function isIgnored(path: string): boolean {
    const patterns = readFileSync(ignoreFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

    let ignored = false;
    for (const pattern of patterns) {
      const negated = pattern.startsWith('!');
      const body = negated ? pattern.slice(1) : pattern;
      // Docker matches path segments; a bare name matches the whole entry.
      const expression = new RegExp(
        `^${body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}(/.*)?$`,
      );
      if (expression.test(path)) ignored = !negated;
    }
    return ignored;
  }

  const MUST_REACH_THE_BUILD: Array<[string, string]> = [
    ['.nixpacks', 'the builder generates its Dockerfile and nix expression here and then COPYs them in'],
    ['nixpacks.toml', 'it pins the Node version and the container entry point'],
    ['package.json', 'nothing installs without it'],
    ['package-lock.json', 'npm ci requires it'],
    ['prisma', 'the schema and migrations — the build generates the client and the container applies them'],
    ['src', 'the application'],
    ['.npmrc', 'it switches install scripts off, and losing it silently re-enables them'],
  ];

  it.each(MUST_REACH_THE_BUILD)('does not exclude %s', (path, why) => {
    expect(isIgnored(path), `.dockerignore excludes ${path}, and ${why}`).toBe(false);
  });

  /**
   * The other direction. A developer's `node_modules` or `dist` copied into the
   * context lands on top of the image's own, which is how a build that looks
   * clean ends up running code nobody built.
   */
  it.each([['node_modules'], ['dist'], ['.env']])('excludes %s', (path) => {
    expect(isIgnored(path), `.dockerignore should exclude ${path}`).toBe(true);
  });

  it('keeps .env.example, which documents names only', () => {
    expect(isIgnored('.env.example')).toBe(false);
  });
});
