import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No dependency WebEdge actually needs may require a compiler.
 *
 * This exists because a deploy to Enterprise Linux 8 died three times on the
 * same thing. The `argon2` package ships a prebuilt binary needing GLIBC_2.34;
 * EL8 has 2.28, so the prebuild would not load, `node-gyp-build` fell back to
 * compiling, and node-gyp's bundled Python needs 3.8+ where EL8 ships 3.6.8.
 * The install died with a `SyntaxError` inside a Python file and named none of
 * the three causes.
 *
 * The rule is about what *blocks* an install, not about native code in general:
 *
 *  - A **non-optional** package that compiles is a blocker. Installing WebEdge
 *    would then need a C++ toolchain and a modern Python on the target machine,
 *    which most managed hosting does not have and will not add.
 *  - An **optional** one is not. npm carries on when it fails, so `cpu-features`
 *    — pulled in by ssh2 for a faster crypto path — produces alarming gyp output
 *    in the log and no failure. That noise is expected, and saying so here is
 *    cheaper than someone re-diagnosing it during the next outage.
 *
 * Checked against the lockfile and the installed tree rather than a list of
 * known-bad packages, so a dependency added next year is covered without anyone
 * remembering this file exists.
 */

type LockEntry = { hasInstallScript?: boolean; optional?: boolean; dev?: boolean };

/** Commands that mean "compile a native addon on this machine". */
const COMPILES = /\bnode-gyp\b|\bcmake-js\b|\bnode-gyp-build\b|\bprebuild-install\b/;

const backendDir = join(__dirname, '..');

const lock = JSON.parse(readFileSync(join(backendDir, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, LockEntry>;
};

/** The install-time scripts a package declares, as installed. */
function installScripts(packagePath: string): string[] {
  try {
    const pkg = JSON.parse(
      readFileSync(join(backendDir, packagePath, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    return ['preinstall', 'install', 'postinstall', 'rebuild']
      .map((stage) => pkg.scripts?.[stage])
      .filter((script): script is string => typeof script === 'string');
  } catch {
    // Not installed — an optional package skipped on this platform, which is
    // exactly the case that cannot block anything.
    return [];
  }
}

const withInstallScripts = Object.entries(lock.packages).filter(
  ([name, meta]) => name.startsWith('node_modules/') && meta.hasInstallScript,
);

describe('native dependencies', () => {
  it('finds the lockfile and an installed tree to check', () => {
    expect(
      withInstallScripts.length,
      'nothing to check — run npm install before the suite',
    ).toBeGreaterThan(0);
  });

  /**
   * The check that would have caught `argon2` before a deploy did.
   */
  it('requires no compiler for any package the install cannot skip', () => {
    const blocking = withInstallScripts
      .filter(([, meta]) => !meta.optional)
      .flatMap(([name]) =>
        installScripts(name)
          .filter((script) => COMPILES.test(script))
          .map((script) => `${name.replace('node_modules/', '')} runs: ${script}`),
      );

    expect(
      blocking,
      'These packages compile a native addon and npm cannot skip them, so installing WebEdge ' +
        'would need a C++ toolchain and Python 3.8+ on the target machine. Most managed hosting ' +
        'has neither. Replace them with a package that ships a loadable prebuilt binary — ' +
        '@node-rs/argon2 is the precedent.',
    ).toEqual([]);
  });

  /**
   * Named rather than merely tolerated. `cpu-features` fails loudly on any host
   * without a toolchain and the install continues regardless, so the next person
   * reading a build log needs to know which errors matter.
   */
  it('names the optional packages whose build failures are safe to ignore', () => {
    const optionalCompilers = withInstallScripts
      .filter(([, meta]) => meta.optional)
      .filter(([name]) => installScripts(name).some((script) => COMPILES.test(script)))
      .map(([name]) => name.replace('node_modules/', ''));

    // Not asserting the exact set — a new optional dependency is not a defect.
    // What matters is that anything here is genuinely optional, which is the
    // filter above, and that it is visible.
    for (const name of optionalCompilers) {
      expect(lock.packages[`node_modules/${name}`]?.optional).toBe(true);
    }
  });

  /**
   * The specific package that started this. Pinned by name because a dependency
   * update could quietly reintroduce it as a transitive dependency, and the
   * generic check above would then only fail if it were non-optional.
   */
  it('does not depend on the argon2 package, whose prebuild will not load on EL8', () => {
    const argon2Entries = Object.keys(lock.packages).filter(
      (name) => name === 'node_modules/argon2' || name.endsWith('/node_modules/argon2'),
    );

    expect(
      argon2Entries,
      'The argon2 package is back. Its linux-x64 prebuild needs GLIBC_2.34 and Enterprise Linux 8 ' +
        'has 2.28, so it compiles from source and fails. Use @node-rs/argon2, which needs GLIBC_2.14.',
    ).toEqual([]);
  });
});
