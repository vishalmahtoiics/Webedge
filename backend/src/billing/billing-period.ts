import { BillingCycle } from '@prisma/client';

/**
 * Renewal date arithmetic.
 *
 * `date.setMonth(date.getMonth() + n)` looks like the obvious way to advance a
 * billing period and is wrong at every month end, because JavaScript overflows
 * rather than clamping:
 *
 *   31 Jan + 1 month  -> 3 March      (not 28 February)
 *   31 Aug + 1 month  -> 1 October    (not 30 September)
 *   29 Feb + 12 months -> 1 March     (not 28 February)
 *
 * Each of those is a billing error. A monthly subscription starting on the 31st
 * renews on the 1st of the month after next, so the customer gets days they were
 * not charged for, and the anniversary drifts forward permanently — every
 * renewal pushes it further. The leap-day case moves a yearly renewal into a
 * different month.
 *
 * The convention here is the one banks and every subscription business uses:
 * clamp to the last day of the target month. 31 January plus one month is
 * 28 February, and the *next* renewal returns to 31 March rather than staying
 * stuck on the 28th, because each period is computed from the anchor date rather
 * than from the previous renewal.
 */

export const MONTHS_IN_CYCLE: Record<BillingCycle, number> = {
  [BillingCycle.MONTHLY]: 1,
  [BillingCycle.QUARTERLY]: 3,
  [BillingCycle.YEARLY]: 12,
  [BillingCycle.BIENNIAL]: 24,
  [BillingCycle.TRIENNIAL]: 36,
};

/** Last day of a month, in UTC. Month is 0-based, as `Date` uses it. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Adds whole months, clamping the day to the target month's length.
 *
 * Time of day is carried through unchanged: a subscription that started at
 * 09:15 renews at 09:15, so a renewal never lands a few hours early and charges
 * before the period it pays for has ended.
 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonth = month + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  // `%` keeps the sign of the dividend, so a negative month count needs the
  // extra wrap. Negative months are used when working a period backwards.
  const normalisedMonth = ((targetMonth % 12) + 12) % 12;

  return new Date(
    Date.UTC(
      targetYear,
      normalisedMonth,
      Math.min(day, daysInMonth(targetYear, normalisedMonth)),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** When a period beginning at `from` ends, for a given billing cycle. */
export function nextRenewal(from: Date, cycle: BillingCycle): Date {
  return addMonths(from, MONTHS_IN_CYCLE[cycle]);
}

/**
 * The renewal after `renewsAt`, measured from the subscription's anchor.
 *
 * Measuring from the anchor rather than from the last renewal is what stops a
 * subscription that once clamped to 28 February from staying on the 28th
 * forever. A subscription anchored on the 31st renews on the 31st of every month
 * that has one.
 */
export function renewalAfter(anchor: Date, renewsAt: Date, cycle: BillingCycle): Date {
  const months = MONTHS_IN_CYCLE[cycle];

  // How many whole cycles have elapsed since the anchor, rounded up, so the
  // result is always after `renewsAt` even if a renewal ran late.
  const elapsed =
    (renewsAt.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (renewsAt.getUTCMonth() - anchor.getUTCMonth());
  const cycles = Math.max(1, Math.ceil(elapsed / months));

  let next = addMonths(anchor, cycles * months);
  // A clamped renewal (28 Feb standing in for the 31st) leaves `next` equal to
  // or before `renewsAt`; step on until it is genuinely in the future of it.
  let guard = 0;
  while (next.getTime() <= renewsAt.getTime() && guard < 120) {
    next = addMonths(anchor, (cycles + ++guard) * months);
  }

  return next;
}
