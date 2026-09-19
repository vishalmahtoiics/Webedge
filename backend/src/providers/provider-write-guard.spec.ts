import { afterEach, describe, expect, it } from 'vitest';
import { TEST_PREFIX, assertWriteAllowed, writeAllowed } from './provider-write-guard';

/**
 * The gate in front of every write to a live provider account.
 *
 * There is no sandbox to point development at. A `DELETE` run from a laptop
 * against the production token removes a real customer's database, and nothing
 * afterwards puts it back — so this is the one guard whose failure mode is
 * other people's data rather than ours.
 */

const original = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = original;
});

describe('outside production', () => {
  it('refuses a write to an ordinary account', () => {
    process.env.NODE_ENV = 'development';

    expect(() =>
      assertWriteAllowed({ what: 'create a database', accountIsStaging: false }),
    ).toThrow(/no provider sandbox/i);
  });

  it('names both ways out, so the reader knows what to do', () => {
    process.env.NODE_ENV = 'development';

    try {
      assertWriteAllowed({ what: 'delete a mailbox', accountIsStaging: false });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/staging/i);
      expect(message).toContain(TEST_PREFIX);
      // And what was refused, not just that something was.
      expect(message).toContain('delete a mailbox');
    }
  });

  it('allows a write to an account marked for staging', () => {
    process.env.NODE_ENV = 'development';

    expect(() =>
      assertWriteAllowed({ what: 'create a database', accountIsStaging: true }),
    ).not.toThrow();
  });

  /** A disposable resource is identifiable in the provider's own panel. */
  it('allows a resource named for testing', () => {
    process.env.NODE_ENV = 'development';

    expect(() =>
      assertWriteAllowed({
        what: 'create a database',
        resourceName: `${TEST_PREFIX}scratch`,
        accountIsStaging: false,
      }),
    ).not.toThrow();
  });

  /**
   * The prefix marks the resource, not a coincidence inside its name. A
   * database called `customer-wetest-notes` belongs to a customer.
   */
  it('requires the prefix at the start', () => {
    process.env.NODE_ENV = 'development';

    expect(() =>
      assertWriteAllowed({
        what: 'delete a database',
        resourceName: `customer-${TEST_PREFIX}notes`,
        accountIsStaging: false,
      }),
    ).toThrow();
  });
});

describe('in production', () => {
  it('allows a write, which is what production is for', () => {
    process.env.NODE_ENV = 'production';

    expect(() =>
      assertWriteAllowed({ what: 'create a database', accountIsStaging: false }),
    ).not.toThrow();
  });
});

describe('asking without throwing', () => {
  /**
   * For the UI: a control that cannot work is shown disabled with the reason.
   * A button that looks live and is not is how someone concludes the panel is
   * broken rather than that it is protecting them.
   */
  it('answers the same question the assertion does', () => {
    process.env.NODE_ENV = 'development';

    expect(writeAllowed(false)).toBe(false);
    expect(writeAllowed(true)).toBe(true);
    expect(writeAllowed(false, `${TEST_PREFIX}db`)).toBe(true);
    expect(writeAllowed(false, 'realdb')).toBe(false);

    process.env.NODE_ENV = 'production';
    expect(writeAllowed(false)).toBe(true);
  });
});
