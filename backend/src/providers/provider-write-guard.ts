import { AppError } from '../common/errors';

/**
 * The gate between WebEdge and a real provider account.
 *
 * There is no provider sandbox. Every write call touches a live account with
 * live customers on it, so the standing rule is that nothing outside production
 * is written unless the resource is plainly disposable or the account is
 * explicitly marked for testing. A `DELETE` issued from a developer's laptop
 * against the production token removes a real customer's database, and no
 * amount of care afterwards puts it back.
 *
 * Two ways through, and no third:
 *
 *  - `NODE_ENV=production`. The deployment that is meant to do this.
 *  - The account is flagged for staging, or the resource being created is
 *    named `wetest-`. Anything a test creates is identifiable at a glance in
 *    the provider's own panel, which is what makes a stray one safe to remove.
 *
 * Reads are never gated. A GET cannot destroy anything, and gating them would
 * make the panel useless in development for no gain.
 */

export type WriteContext = {
  /** What is being acted on, for the message when it is refused. */
  what: string;
  /** The resource's name, when the call creates or renames one. */
  resourceName?: string;
  /** Whether the account itself is marked as a staging account. */
  accountIsStaging: boolean;
};

/** The prefix that marks a resource as disposable. */
export const TEST_PREFIX = 'wetest-';

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Throws unless this write is allowed here.
 *
 * The error names the rule rather than saying "forbidden", because the person
 * reading it is a developer who needs to know which of the three ways out
 * applies to them.
 */
export function assertWriteAllowed(context: WriteContext): void {
  if (isProduction()) return;
  if (context.accountIsStaging) return;
  if (context.resourceName?.startsWith(TEST_PREFIX)) return;

  throw new AppError(
    'PERMISSION_DENIED',
    `Refusing to ${context.what} on a live provider account outside production. ` +
      `There is no provider sandbox — this would change a real account. ` +
      `Either mark the account as staging, or name the resource "${TEST_PREFIX}…" so it is ` +
      `identifiable as disposable in the provider's own panel.`,
  );
}

/**
 * Whether a write would be allowed, without throwing.
 *
 * For the UI, so a control that cannot work is shown disabled with the reason
 * rather than failing when pressed. A button that looks live and is not is how
 * someone concludes the panel is broken.
 */
export function writeAllowed(accountIsStaging: boolean, resourceName?: string): boolean {
  return (
    isProduction() || accountIsStaging || (resourceName?.startsWith(TEST_PREFIX) ?? false)
  );
}
