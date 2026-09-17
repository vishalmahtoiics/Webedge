import { describe, expect, it } from 'vitest';
import {
  calculateInvoice,
  fromInclusivePrice,
  isValidGstinFormat,
  placeOfSupply,
  prorate,
  stateCodeFromGstin,
  taxKindFor,
  type Party,
} from './gst';

/** WebEdge's own registration, for these tests. Maharashtra. */
const supplier: Party = { stateCode: '27', gstin: '27AAPFU0939F1ZV' };

const customerIn = (stateCode: string, gstin?: string): Party => ({ stateCode, gstin });

const line = (rupees: number, quantity = 1) => ({
  description: 'Business hosting, 1 year',
  unitPriceInPaise: rupees * 100,
  quantity,
});

describe('place of supply', () => {
  it('uses the customer state when recorded', () => {
    expect(placeOfSupply(supplier, customerIn('29'))).toBe('29');
  });

  /**
   * s.12(2) IGST Act: with no recipient address on record the supplier's
   * location applies. The fallback makes the supply intra-state — not untaxed,
   * which is the mistake this guards against.
   */
  it('falls back to the supplier state when the customer state is unknown', () => {
    expect(placeOfSupply(supplier, { stateCode: '' })).toBe('27');
    expect(placeOfSupply(supplier, { stateCode: '   ' })).toBe('27');
  });

  it('uses the country for a customer outside India', () => {
    expect(placeOfSupply(supplier, { stateCode: '', countryCode: 'AE' })).toBe('AE');
  });
});

describe('which tax applies', () => {
  it('charges CGST and SGST within the supplier state', () => {
    expect(taxKindFor(supplier, customerIn('27'))).toBe('CGST_SGST');
  });

  it('charges IGST across states', () => {
    expect(taxKindFor(supplier, customerIn('29'))).toBe('IGST');
    expect(taxKindFor(supplier, customerIn('07'))).toBe('IGST');
  });

  it('treats a supply outside India as zero-rated', () => {
    expect(taxKindFor(supplier, { stateCode: '', countryCode: 'US' })).toBe('ZERO_RATED');
  });

  it('applies the intra-state fallback when the customer state is missing', () => {
    expect(taxKindFor(supplier, { stateCode: '' })).toBe('CGST_SGST');
  });
});

describe('intra-state invoice', () => {
  const result = calculateInvoice({ supplier, customer: customerIn('27'), lines: [line(4499)] });

  it('splits 18% into 9% CGST and 9% SGST', () => {
    expect(result.subtotalInPaise).toBe(449_900);
    expect(result.cgstInPaise).toBe(40_491);
    expect(result.sgstInPaise).toBe(40_491);
    expect(result.igstInPaise).toBe(0);
  });

  it('halves that sum exactly to the total tax', () => {
    expect(result.cgstInPaise + result.sgstInPaise).toBe(result.totalTaxInPaise);
  });

  it('rounds the payable amount to whole rupees', () => {
    expect(result.totalInPaise % 100).toBe(0);
    expect(result.totalInPaise).toBe(530_900);
  });
});

describe('inter-state invoice', () => {
  const result = calculateInvoice({ supplier, customer: customerIn('29'), lines: [line(4499)] });

  it('charges the whole 18% as IGST', () => {
    expect(result.igstInPaise).toBe(80_982);
    expect(result.cgstInPaise).toBe(0);
    expect(result.sgstInPaise).toBe(0);
  });

  /** The customer pays the same either way; only the split differs. */
  it('comes to the same total as the intra-state invoice', () => {
    const intra = calculateInvoice({ supplier, customer: customerIn('27'), lines: [line(4499)] });
    expect(result.totalInPaise).toBe(intra.totalInPaise);
  });
});

describe('export of services', () => {
  const result = calculateInvoice({
    supplier,
    customer: { stateCode: '', countryCode: 'SG' },
    lines: [line(4499)],
  });

  it('charges no tax', () => {
    expect(result.totalTaxInPaise).toBe(0);
    expect(result.totalInPaise).toBe(449_900);
  });
});

describe('rounding', () => {
  /**
   * An odd tax amount cannot be halved evenly. Rounding each half separately
   * loses or gains a paisa, and the invoice then fails to reconcile against its
   * own lines.
   */
  it('gives the odd paisa to CGST rather than losing it', () => {
    const result = calculateInvoice({
      supplier,
      customer: customerIn('27'),
      // 999 paise * 18% = 179.82 -> 180, which is even; 1000*18% = 180 too.
      // 105 paise * 18% = 18.9 -> 19, an odd number that must still split.
      lines: [{ description: 'odd', unitPriceInPaise: 105, quantity: 1 }],
    });

    expect(result.cgstInPaise + result.sgstInPaise).toBe(19);
    expect(result.cgstInPaise).toBe(10);
    expect(result.sgstInPaise).toBe(9);
  });

  it('reports the round-off so the invoice reconciles', () => {
    const result = calculateInvoice({
      supplier,
      customer: customerIn('27'),
      lines: [{ description: 'odd', unitPriceInPaise: 105, quantity: 1 }],
    });

    expect(result.subtotalInPaise + result.totalTaxInPaise + result.roundOffInPaise).toBe(
      result.totalInPaise,
    );
  });

  it('always lands on a whole rupee', () => {
    for (const paise of [1, 99, 100, 149, 150, 151, 12_345, 99_999]) {
      const result = calculateInvoice({
        supplier,
        customer: customerIn('27'),
        lines: [{ description: 'x', unitPriceInPaise: paise, quantity: 1 }],
      });
      expect(result.totalInPaise % 100, `${paise} paise`).toBe(0);
    }
  });
});

describe('multiple lines and quantities', () => {
  it('taxes per line and sums, rather than taxing the total', () => {
    const result = calculateInvoice({
      supplier,
      customer: customerIn('29'),
      lines: [line(1499), line(4499), line(299, 3)],
    });

    const expectedSubtotal = 149_900 + 449_900 + 29_900 * 3;
    expect(result.subtotalInPaise).toBe(expectedSubtotal);

    const perLine = result.lines.reduce((sum, l) => sum + l.igstInPaise, 0);
    expect(result.igstInPaise).toBe(perLine);
  });
});

describe('discounts', () => {
  /** s.15(3)(a): a discount given before supply reduces the taxable value. */
  it('reduces the taxable value, so tax follows what is actually paid', () => {
    const full = calculateInvoice({ supplier, customer: customerIn('29'), lines: [line(1000)] });
    const discounted = calculateInvoice({
      supplier,
      customer: customerIn('29'),
      lines: [line(1000)],
      discountInPaise: 20_000,
    });

    expect(discounted.subtotalInPaise).toBe(80_000);
    expect(discounted.igstInPaise).toBeLessThan(full.igstInPaise);
    expect(discounted.igstInPaise).toBe(14_400);
  });

  it('spreads a discount across lines without losing a paisa', () => {
    const result = calculateInvoice({
      supplier,
      customer: customerIn('29'),
      lines: [line(1000), line(2000), line(3000)],
      discountInPaise: 10_001, // deliberately indivisible by three
    });

    const discountApplied =
      600_000 - result.lines.reduce((sum, l) => sum + l.taxableValueInPaise, 0);
    expect(discountApplied).toBe(10_001);
  });

  it('never discounts below zero', () => {
    const result = calculateInvoice({
      supplier,
      customer: customerIn('29'),
      lines: [line(100)],
      discountInPaise: 999_999,
    });

    expect(result.subtotalInPaise).toBe(0);
    expect(result.totalInPaise).toBe(0);
  });
});

describe('credit notes', () => {
  /**
   * Math.round rounds half *up*, so -0.5 becomes -0 — a credit note that does
   * not exactly reverse its invoice. Rounding half away from zero keeps them
   * symmetric.
   */
  it('reverses an invoice exactly when the amounts are negated', () => {
    const lines = [{ description: 'odd', unitPriceInPaise: 105, quantity: 1 }];
    const invoice = calculateInvoice({ supplier, customer: customerIn('27'), lines });
    const credit = calculateInvoice({
      supplier,
      customer: customerIn('27'),
      lines: lines.map((l) => ({ ...l, unitPriceInPaise: -l.unitPriceInPaise })),
    });

    expect(credit.totalInPaise).toBe(-invoice.totalInPaise);
    expect(credit.totalTaxInPaise).toBe(-invoice.totalTaxInPaise);
  });
});

describe('tax-inclusive pricing', () => {
  /** The taxable value is the price divided by 1.18, not the price minus 18%. */
  it('divides rather than subtracting', () => {
    const { taxableValueInPaise, taxInPaise } = fromInclusivePrice(118_000);

    expect(taxableValueInPaise).toBe(100_000);
    expect(taxInPaise).toBe(18_000);
    // Subtracting 18% would have given 96,760 — nearly 32 rupees adrift.
    expect(taxableValueInPaise).not.toBe(118_000 - 21_240);
  });

  it('always sums back to the original price', () => {
    for (const paise of [1, 99, 4_999, 149_900, 1_199_900]) {
      const { taxableValueInPaise, taxInPaise } = fromInclusivePrice(paise);
      expect(taxableValueInPaise + taxInPaise, `${paise}`).toBe(paise);
    }
  });
});

describe('proration', () => {
  const periodStart = new Date('2026-01-01T00:00:00Z');
  const periodEnd = new Date('2027-01-01T00:00:00Z');

  it('credits the unused part of a year', () => {
    const result = prorate({
      amountInPaise: 365_000,
      periodStart,
      periodEnd,
      changeDate: new Date('2026-07-01T00:00:00Z'),
    });

    expect(result.usedDays).toBe(181);
    expect(result.remainingDays).toBe(184);
    expect(result.unusedCreditInPaise).toBe(184_000);
  });

  it('credits nothing at the end of the period', () => {
    expect(
      prorate({ amountInPaise: 365_000, periodStart, periodEnd, changeDate: periodEnd })
        .unusedCreditInPaise,
    ).toBe(0);
  });

  it('credits the whole amount at the start', () => {
    expect(
      prorate({ amountInPaise: 365_000, periodStart, periodEnd, changeDate: periodStart })
        .unusedCreditInPaise,
    ).toBe(365_000);
  });

  it('clamps a change date outside the period', () => {
    const before = prorate({
      amountInPaise: 365_000,
      periodStart,
      periodEnd,
      changeDate: new Date('2025-06-01T00:00:00Z'),
    });
    const after = prorate({
      amountInPaise: 365_000,
      periodStart,
      periodEnd,
      changeDate: new Date('2028-06-01T00:00:00Z'),
    });

    expect(before.unusedCreditInPaise).toBe(365_000);
    expect(after.unusedCreditInPaise).toBe(0);
  });

  /** Rounding down means never crediting more than is owed. */
  it('rounds the credit down', () => {
    const result = prorate({
      amountInPaise: 100,
      periodStart,
      periodEnd,
      changeDate: new Date('2026-07-01T00:00:00Z'),
    });
    expect(result.unusedCreditInPaise).toBe(50);
  });
});

describe('GSTIN', () => {
  it('accepts a well-formed GSTIN', () => {
    expect(isValidGstinFormat('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstinFormat(' 27aapfu0939f1zv ')).toBe(true);
  });

  it('rejects malformed values', () => {
    for (const bad of ['', 'NOTAGSTIN', '27AAPFU0939F1Z', '27AAPFU0939F1ZVX', 'AA27PFU0939F1ZV']) {
      expect(isValidGstinFormat(bad), bad).toBe(false);
    }
  });

  /**
   * A GSTIN carries its own state code, so a customer claiming Karnataka with a
   * Maharashtra GSTIN is a mismatch worth catching — it changes which tax
   * applies.
   */
  it('exposes the state code so it can be checked against the stated state', () => {
    expect(stateCodeFromGstin('27AAPFU0939F1ZV')).toBe('27');
    expect(stateCodeFromGstin('29AAPFU0939F1ZV')).toBe('29');
    expect(stateCodeFromGstin('nonsense')).toBeNull();
  });
});
