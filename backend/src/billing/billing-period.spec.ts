import { describe, expect, it } from 'vitest';
import { BillingCycle } from '@prisma/client';
import { addMonths, nextRenewal, renewalAfter } from './billing-period';

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (value: string) => new Date(`${value}T00:00:00Z`);

describe('adding months', () => {
  it('advances an ordinary date', () => {
    expect(iso(addMonths(utc('2026-03-15'), 1))).toBe('2026-04-15');
    expect(iso(addMonths(utc('2026-03-15'), 12))).toBe('2027-03-15');
  });

  /**
   * The bug this module exists for. `setMonth` overflows into the following
   * month, so a monthly plan starting on the 31st renews on the 1st of the month
   * after next — the customer gets days nobody charged for, and the anniversary
   * drifts forward at every renewal.
   */
  it('clamps to the last day of a shorter month instead of overflowing', () => {
    expect(iso(addMonths(utc('2026-01-31'), 1))).toBe('2026-02-28');
    expect(iso(addMonths(utc('2026-08-31'), 1))).toBe('2026-09-30');
    expect(iso(addMonths(utc('2026-05-31'), 1))).toBe('2026-06-30');
  });

  it('keeps a leap day on 29 February when the target year has one', () => {
    expect(iso(addMonths(utc('2028-02-29'), 48))).toBe('2032-02-29');
  });

  it('clamps a leap day to the 28th when the target year has none', () => {
    expect(iso(addMonths(utc('2028-02-29'), 12))).toBe('2029-02-28');
  });

  it('crosses a year boundary', () => {
    expect(iso(addMonths(utc('2026-11-30'), 3))).toBe('2027-02-28');
    expect(iso(addMonths(utc('2026-12-31'), 1))).toBe('2027-01-31');
  });

  /** Used when working a period backwards, so it must clamp the same way. */
  it('goes backwards, clamping the same way', () => {
    expect(iso(addMonths(utc('2026-03-31'), -1))).toBe('2026-02-28');
    expect(iso(addMonths(utc('2026-01-15'), -1))).toBe('2025-12-15');
    expect(iso(addMonths(utc('2026-01-15'), -13))).toBe('2024-12-15');
  });

  /**
   * A renewal that landed a few hours early would charge before the period it
   * pays for had ended.
   */
  it('carries the time of day through unchanged', () => {
    const at = new Date('2026-01-31T09:15:30.250Z');
    expect(addMonths(at, 1).toISOString()).toBe('2026-02-28T09:15:30.250Z');
  });
});

describe('renewal dates by cycle', () => {
  it('advances by the cycle length', () => {
    const start = utc('2026-04-10');
    expect(iso(nextRenewal(start, BillingCycle.MONTHLY))).toBe('2026-05-10');
    expect(iso(nextRenewal(start, BillingCycle.QUARTERLY))).toBe('2026-07-10');
    expect(iso(nextRenewal(start, BillingCycle.YEARLY))).toBe('2027-04-10');
    expect(iso(nextRenewal(start, BillingCycle.BIENNIAL))).toBe('2028-04-10');
    expect(iso(nextRenewal(start, BillingCycle.TRIENNIAL))).toBe('2029-04-10');
  });
});

describe('the renewal after a renewal', () => {
  /**
   * The reason renewals are measured from the anchor rather than from the last
   * renewal. Chaining from the previous date would leave a subscription that
   * once clamped to 28 February stuck on the 28th for the rest of its life.
   */
  it('returns to the anchor day after a clamped month', () => {
    const anchor = utc('2026-01-31');
    const first = nextRenewal(anchor, BillingCycle.MONTHLY); // clamped to 28 Feb
    expect(iso(first)).toBe('2026-02-28');

    const second = renewalAfter(anchor, first, BillingCycle.MONTHLY);
    expect(iso(second)).toBe('2026-03-31');

    const third = renewalAfter(anchor, second, BillingCycle.MONTHLY);
    expect(iso(third)).toBe('2026-04-30');

    const fourth = renewalAfter(anchor, third, BillingCycle.MONTHLY);
    expect(iso(fourth)).toBe('2026-05-31');
  });

  it('always moves forward, even when a renewal ran late', () => {
    const anchor = utc('2026-01-15');
    // Four months overdue: the next renewal must still be in the future of the
    // date it is computed from, not another date in the past.
    const overdue = utc('2026-05-15');
    const next = renewalAfter(anchor, overdue, BillingCycle.MONTHLY);

    expect(next.getTime()).toBeGreaterThan(overdue.getTime());
    expect(iso(next)).toBe('2026-06-15');
  });

  it('advances a yearly subscription by a year', () => {
    const anchor = utc('2026-06-01');
    const first = nextRenewal(anchor, BillingCycle.YEARLY);
    expect(iso(renewalAfter(anchor, first, BillingCycle.YEARLY))).toBe('2028-06-01');
  });

  /** Every renewal over five years stays on the anchor day or its clamp. */
  it('never drifts off the anchor day', () => {
    const anchor = utc('2026-01-31');
    let current = nextRenewal(anchor, BillingCycle.MONTHLY);

    for (let i = 0; i < 60; i += 1) {
      const day = current.getUTCDate();
      const lastDayOfMonth = new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0),
      ).getUTCDate();

      // Either the anchor day, or the month's last day because it is shorter.
      expect(day === 31 || day === lastDayOfMonth, current.toISOString()).toBe(true);
      current = renewalAfter(anchor, current, BillingCycle.MONTHLY);
    }
  });
});
