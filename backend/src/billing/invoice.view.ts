import type { Invoice, InvoiceLine } from '@prisma/client';

/**
 * The serialized shape of an invoice.
 *
 * Explicit rather than returning the Prisma row, for two reasons. A column added
 * later — an internal note, a provider reference, a payment gateway id — would
 * otherwise appear in a customer's JSON the moment it is added to the schema.
 * And an invoice is a legal document: what it shows should be a decision, not a
 * side effect of the table's shape.
 *
 * Amounts stay in integer paise all the way to the browser. Formatting for
 * display is the UI's job; dividing by 100 here would reintroduce the float that
 * `gst.ts` exists to avoid.
 */

export type InvoiceLineView = {
  description: string;
  sacCode: string;
  quantity: number;
  unitPriceInPaise: number;
  gstRateBps: number;
  taxableValueInPaise: number;
  cgstInPaise: number;
  sgstInPaise: number;
  igstInPaise: number;
};

export type InvoiceView = {
  id: string;
  invoiceNumber: string | null;
  financialYear: string | null;
  status: Invoice['status'];
  supplierStateCode: string;
  supplierGstin: string | null;
  customerName: string;
  customerGstin: string | null;
  customerStateCode: string;
  placeOfSupply: string;
  taxKind: string;
  subtotalInPaise: number;
  discountInPaise: number;
  cgstInPaise: number;
  sgstInPaise: number;
  igstInPaise: number;
  roundOffInPaise: number;
  totalInPaise: number;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  lines?: InvoiceLineView[];
};

export function invoiceView(invoice: Invoice & { lines?: InvoiceLine[] }): InvoiceView {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    financialYear: invoice.financialYear,
    status: invoice.status,
    supplierStateCode: invoice.supplierStateCode,
    supplierGstin: invoice.supplierGstin,
    customerName: invoice.customerName,
    customerGstin: invoice.customerGstin,
    customerStateCode: invoice.customerStateCode,
    placeOfSupply: invoice.placeOfSupply,
    taxKind: invoice.taxKind,
    subtotalInPaise: invoice.subtotalInPaise,
    discountInPaise: invoice.discountInPaise,
    cgstInPaise: invoice.cgstInPaise,
    sgstInPaise: invoice.sgstInPaise,
    igstInPaise: invoice.igstInPaise,
    roundOffInPaise: invoice.roundOffInPaise,
    totalInPaise: invoice.totalInPaise,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    paidAt: invoice.paidAt,
    voidedAt: invoice.voidedAt,
    // A customer is told an invoice was cancelled and why. Hiding the reason
    // leaves them with a document that changed for no visible cause.
    voidReason: invoice.voidReason,
    ...(invoice.lines
      ? {
          lines: invoice.lines.map((line) => ({
            description: line.description,
            sacCode: line.sacCode,
            quantity: line.quantity,
            unitPriceInPaise: line.unitPriceInPaise,
            gstRateBps: line.gstRateBps,
            taxableValueInPaise: line.taxableValueInPaise,
            cgstInPaise: line.cgstInPaise,
            sgstInPaise: line.sgstInPaise,
            igstInPaise: line.igstInPaise,
          })),
        }
      : {}),
  };
}
