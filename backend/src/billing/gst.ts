/**
 * GST calculation for Indian invoices — pure functions, integer paise.
 *
 * **This needs a Chartered Accountant's review before it bills anyone.** The
 * rules encoded here are the ones that apply to hosting services sold from one
 * Indian state to customers in India and abroad, as understood from the CGST and
 * IGST Acts. Tax law has more corners than any code comment, and getting it
 * wrong is expensive in a way that a bug in the file manager is not. What this
 * file gives a CA is something concrete to check, with the reasoning visible.
 *
 * Everything is integer paise. Money in floats produces 0.1 + 0.2 = 0.30000000000000004,
 * and on an invoice that becomes a rupee that does not reconcile.
 */

/** Hosting is an online information and database access service: SAC 998315, taxed at 18%. */
export const HOSTING_SAC_CODE = '998315';
export const HOSTING_GST_RATE_BPS = 1800; // 18%, in basis points to stay integral

export type TaxKind = 'CGST_SGST' | 'IGST' | 'ZERO_RATED';

export type Party = {
  /** State code as used on a GSTIN, e.g. '27' for Maharashtra. */
  stateCode: string;
  /** Present for a registered business; absent for a consumer. */
  gstin?: string | null;
  /** Set for a customer outside India. */
  countryCode?: string;
};

export type LineItem = {
  description: string;
  /** Unit price excluding tax, in paise. */
  unitPriceInPaise: number;
  quantity: number;
  sacCode?: string;
  gstRateBps?: number;
};

export type TaxedLine = LineItem & {
  sacCode: string;
  gstRateBps: number;
  taxableValueInPaise: number;
  cgstInPaise: number;
  sgstInPaise: number;
  igstInPaise: number;
};

export type InvoiceTotals = {
  lines: TaxedLine[];
  taxKind: TaxKind;
  placeOfSupplyStateCode: string;
  subtotalInPaise: number;
  discountInPaise: number;
  cgstInPaise: number;
  sgstInPaise: number;
  igstInPaise: number;
  totalTaxInPaise: number;
  /** Rounded to the nearest rupee, per s.170 of the CGST Act. */
  roundOffInPaise: number;
  totalInPaise: number;
};

/**
 * Where the supply is treated as made, which decides whether tax is CGST+SGST or
 * IGST.
 *
 * For services delivered online, s.12(2) of the IGST Act puts the place of
 * supply at the recipient's location when it is on record, and at the supplier's
 * when it is not. That fallback matters: an unrecorded consumer address makes
 * the supply intra-state, not untaxed.
 */
export function placeOfSupply(supplier: Party, customer: Party): string {
  if (customer.countryCode && customer.countryCode !== 'IN') return customer.countryCode;
  return customer.stateCode?.trim() || supplier.stateCode;
}

export function taxKindFor(supplier: Party, customer: Party): TaxKind {
  // Export of services is zero-rated under s.16 of the IGST Act, but only
  // against a LUT or with IGST paid and reclaimed. Which of those applies is a
  // decision for the business, not for this function — it reports zero-rated and
  // the invoice template must carry the right declaration.
  if (customer.countryCode && customer.countryCode !== 'IN') return 'ZERO_RATED';

  return placeOfSupply(supplier, customer) === supplier.stateCode ? 'CGST_SGST' : 'IGST';
}

/**
 * Rounds half away from zero.
 *
 * `Math.round` rounds half *up*, so -0.5 becomes -0 rather than -1 — which
 * silently understates tax on a credit note. Every rounding here is symmetric so
 * a credit note is the exact negative of the invoice it reverses.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Splits a CGST+SGST amount into two halves that sum exactly to the total.
 *
 * An odd number of paise cannot be halved evenly, and rounding each half
 * independently loses or gains a paisa — which then fails to reconcile against
 * the invoice total. The remainder goes to CGST by convention.
 */
function splitHalves(totalTax: number): { cgst: number; sgst: number } {
  const sgst = Math.trunc(totalTax / 2);
  return { cgst: totalTax - sgst, sgst };
}

/**
 * Taxes one line.
 *
 * Tax is computed per line and the results summed, rather than computed on the
 * invoice total. For a single rate the two agree, but they diverge the moment an
 * invoice mixes rates, and per-line is what the return expects.
 */
function taxLine(line: LineItem, taxKind: TaxKind, discountInPaise: number): TaxedLine {
  const sacCode = line.sacCode ?? HOSTING_SAC_CODE;
  const gstRateBps = line.gstRateBps ?? HOSTING_GST_RATE_BPS;

  const gross = line.unitPriceInPaise * line.quantity;
  // A discount given before supply reduces the taxable value (s.15(3)(a)), so
  // tax is charged on what the customer actually pays, not the list price.
  //
  // Reduced toward zero rather than floored at zero: a credit note carries
  // negative amounts, and clamping at zero would silently turn every credit note
  // into a zero-value document.
  const reduced = gross - discountInPaise;
  const taxableValueInPaise = Math.sign(reduced) === -Math.sign(gross) ? 0 : reduced;

  const tax = taxKind === 'ZERO_RATED'
    ? 0
    : roundHalfAwayFromZero((taxableValueInPaise * gstRateBps) / 10_000);

  if (taxKind === 'IGST') {
    return { ...line, sacCode, gstRateBps, taxableValueInPaise, cgstInPaise: 0, sgstInPaise: 0, igstInPaise: tax };
  }
  if (taxKind === 'ZERO_RATED') {
    return { ...line, sacCode, gstRateBps, taxableValueInPaise, cgstInPaise: 0, sgstInPaise: 0, igstInPaise: 0 };
  }

  const { cgst, sgst } = splitHalves(tax);
  return { ...line, sacCode, gstRateBps, taxableValueInPaise, cgstInPaise: cgst, sgstInPaise: sgst, igstInPaise: 0 };
}

/**
 * Builds invoice totals.
 *
 * `discountInPaise` is applied across the invoice, distributed over lines in
 * proportion to their value so the parts sum exactly to the whole and no line is
 * reduced past zero. Negative lines are supported: that is how a credit note
 * reverses an invoice.
 */
export function calculateInvoice(options: {
  supplier: Party;
  customer: Party;
  lines: LineItem[];
  discountInPaise?: number;
}): InvoiceTotals {
  const { supplier, customer, lines } = options;
  const taxKind = taxKindFor(supplier, customer);

  const gross = lines.reduce((sum, line) => sum + line.unitPriceInPaise * line.quantity, 0);

  // A credit note has a negative gross. The discount is clamped against the
  // magnitude and then carried in the same direction, so it reduces the document
  // toward zero either way instead of inverting it.
  const sign = gross < 0 ? -1 : 1;
  const discountMagnitude = Math.min(Math.max(options.discountInPaise ?? 0, 0), Math.abs(gross));
  const discountInPaise = discountMagnitude * sign;

  // Distributed proportionally, with the remainder on the last line so the
  // distributed parts sum exactly to the discount.
  let distributed = 0;
  const taxed = lines.map((line, index) => {
    const lineGross = line.unitPriceInPaise * line.quantity;
    const isLast = index === lines.length - 1;
    const share = isLast
      ? discountInPaise - distributed
      : gross === 0
        ? 0
        : Math.trunc((discountInPaise * lineGross) / gross);
    distributed += share;
    return taxLine(line, taxKind, share);
  });

  const subtotalInPaise = taxed.reduce((sum, line) => sum + line.taxableValueInPaise, 0);
  const cgstInPaise = taxed.reduce((sum, line) => sum + line.cgstInPaise, 0);
  const sgstInPaise = taxed.reduce((sum, line) => sum + line.sgstInPaise, 0);
  const igstInPaise = taxed.reduce((sum, line) => sum + line.igstInPaise, 0);
  const totalTaxInPaise = cgstInPaise + sgstInPaise + igstInPaise;

  // s.170 CGST Act: the amount payable is rounded to the nearest rupee, and the
  // difference is shown as a round-off line rather than absorbed silently.
  const beforeRounding = subtotalInPaise + totalTaxInPaise;
  const totalInPaise = roundHalfAwayFromZero(beforeRounding / 100) * 100;

  return {
    lines: taxed,
    taxKind,
    placeOfSupplyStateCode: placeOfSupply(supplier, customer),
    subtotalInPaise,
    discountInPaise,
    cgstInPaise,
    sgstInPaise,
    igstInPaise,
    totalTaxInPaise,
    roundOffInPaise: totalInPaise - beforeRounding,
    totalInPaise,
  };
}

/**
 * Splits a tax-inclusive price back out.
 *
 * Needed whenever a price is advertised "inclusive of taxes": the taxable value
 * is not the price minus 18%, it is the price divided by 1.18.
 */
export function fromInclusivePrice(
  inclusiveInPaise: number,
  gstRateBps = HOSTING_GST_RATE_BPS,
): { taxableValueInPaise: number; taxInPaise: number } {
  const taxableValueInPaise = roundHalfAwayFromZero(
    (inclusiveInPaise * 10_000) / (10_000 + gstRateBps),
  );
  return { taxableValueInPaise, taxInPaise: inclusiveInPaise - taxableValueInPaise };
}

/**
 * Proration for a mid-cycle plan change, by whole days.
 *
 * Days rather than milliseconds, because an invoice a customer can check by hand
 * beats one that is a few paise "more correct" and impossible to verify.
 */
export function prorate(options: {
  amountInPaise: number;
  periodStart: Date;
  periodEnd: Date;
  changeDate: Date;
}): { usedDays: number; remainingDays: number; unusedCreditInPaise: number } {
  const day = 86_400_000;
  const totalDays = Math.max(1, Math.round((options.periodEnd.getTime() - options.periodStart.getTime()) / day));
  const usedDays = Math.min(
    totalDays,
    Math.max(0, Math.round((options.changeDate.getTime() - options.periodStart.getTime()) / day)),
  );
  const remainingDays = totalDays - usedDays;

  return {
    usedDays,
    remainingDays,
    // Rounded down: crediting a customer a paisa more than they are owed is a
    // reconciliation problem, and rounding against ourselves is the safe side.
    unusedCreditInPaise: Math.floor((options.amountInPaise * remainingDays) / totalDays),
  };
}

/** GSTIN format: 2-digit state, 10-character PAN, entity code, 'Z', checksum. */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function isValidGstinFormat(gstin: string): boolean {
  return GSTIN_PATTERN.test(gstin.trim().toUpperCase());
}

/** The state code a GSTIN declares, which must match the customer's stated state. */
export function stateCodeFromGstin(gstin: string): string | null {
  const trimmed = gstin.trim().toUpperCase();
  return isValidGstinFormat(trimmed) ? trimmed.slice(0, 2) : null;
}
