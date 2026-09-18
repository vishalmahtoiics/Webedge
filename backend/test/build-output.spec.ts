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
