import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AppError, notFound } from '../common/errors';
import { calculateInvoice, type LineItem, type Party } from './gst';
import type { Principal } from '../common/principal';

/**
 * Issues and stores invoices.
 *
 * Two rules shape this and both come from GST rather than from preference:
 *
 *  - The serial number must be consecutive, unique within the financial year,
 *    and gapless (Rule 46(b), CGST Rules). A gap is what an auditor asks about.
 *  - An issued invoice is immutable. A mistake is corrected by voiding it and
 *    issuing a credit note, never by editing the original or deleting it — a
 *    missing number reads as a gap just as surely as a skipped one.
 */

export type IssueInvoiceInput = {
  customerId: string;
  lines: LineItem[];
  discountInPaise?: number;
  dueAt?: Date;
};

/**
 * The Indian financial year runs 1 April to 31 March, so January 2027 belongs to
 * "2026-27". Using the calendar year would restart the sequence three months
 * early and produce two invoices with the same number.
 */
export function financialYearFor(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-based; March is 2
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function formatInvoiceNumber(financialYear: string, serial: number): string {
  return `WEB/${financialYear}/${String(serial).padStart(5, '0')}`;
}

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Allocates the next serial number for a financial year.
   *
   * A single atomic statement, not a read followed by a write: two concurrent
   * requests reading the same `lastNumber` would both write the same next value,
   * and the unique constraint would reject one *after* the work was done. The
   * upsert increments inside the database, so concurrent callers queue on the
   * row and each gets a distinct number.
   *
   * Must run inside the same transaction as the invoice it numbers, so a failure
   * after allocation rolls the counter back rather than burning a number.
   */
  private async allocateSerial(
    tx: Prisma.TransactionClient,
    financialYear: string,
  ): Promise<number> {
    const [row] = await tx.$queryRaw<Array<{ lastNumber: number }>>`
      INSERT INTO invoice_sequences ("financialYear", "lastNumber", "updatedAt")
      VALUES (${financialYear}, 1, now())
      ON CONFLICT ("financialYear")
      DO UPDATE SET "lastNumber" = invoice_sequences."lastNumber" + 1, "updatedAt" = now()
      RETURNING "lastNumber"
    `;

    if (!row) throw new AppError('OPERATION_FAILED', 'Could not allocate an invoice number.');
    return row.lastNumber;
  }

  /**
   * Issues an invoice.
   *
   * The number is allocated and the invoice written in one transaction, so a
   * failure anywhere leaves neither a numbered invoice nor a consumed number.
   */
  async issue(principal: Principal | undefined, input: IssueInvoiceInput) {
    const customer = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw notFound('customer');

    if (input.lines.length === 0) {
      throw new AppError('INVALID_REQUEST', 'An invoice needs at least one line.');
    }

    const settings = await this.supplierParty();
    const customerParty: Party = {
      stateCode: customer.billingState ?? '',
      gstin: customer.gstin,
    };

    const totals = calculateInvoice({
      supplier: settings,
      customer: customerParty,
      lines: input.lines,
      discountInPaise: input.discountInPaise,
    });

    const issuedAt = new Date();
    const financialYear = financialYearFor(issuedAt);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const serial = await this.allocateSerial(tx, financialYear);

      return tx.invoice.create({
        data: {
          customerId: customer.id,
          invoiceNumber: formatInvoiceNumber(financialYear, serial),
          financialYear,
          serialNumber: serial,
          status: InvoiceStatus.ISSUED,

          // Snapshotted: an invoice records what was charged then, and must not
          // change because a rate or an address changed later.
          supplierStateCode: settings.stateCode,
          supplierGstin: settings.gstin ?? null,
          customerName: customer.companyName ?? customer.fullName,
          customerGstin: customer.gstin,
          customerStateCode: customerParty.stateCode,
          placeOfSupply: totals.placeOfSupplyStateCode,
          taxKind: totals.taxKind,

          subtotalInPaise: totals.subtotalInPaise,
          discountInPaise: totals.discountInPaise,
          cgstInPaise: totals.cgstInPaise,
          sgstInPaise: totals.sgstInPaise,
          igstInPaise: totals.igstInPaise,
          roundOffInPaise: totals.roundOffInPaise,
          totalInPaise: totals.totalInPaise,

          issuedAt,
          dueAt: input.dueAt ?? null,

          lines: {
            create: totals.lines.map((line) => ({
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
          },
        },
        include: { lines: true },
      });
    });

    await this.activity.record(principal, {
      action: 'billing.invoice.issued',
      customerId: customer.id,
      resourceType: 'invoice',
      resourceId: invoice.id,
      visibility: 'CUSTOMER',
      newValue: { invoiceNumber: invoice.invoiceNumber, totalInPaise: invoice.totalInPaise },
    });

    return invoice;
  }

  /**
   * Voids an invoice, keeping its number.
   *
   * Cancellation, not deletion: removing the row would leave a gap in the serial
   * sequence, which is indistinguishable from a suppressed invoice.
   */
  async voidInvoice(principal: Principal, invoiceId: string, reason: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw notFound('invoice');

    if (invoice.status === InvoiceStatus.PAID) {
      throw new AppError(
        'CONFLICT',
        'A paid invoice cannot be voided. Issue a credit note against it instead.',
      );
    }
    if (invoice.status === InvoiceStatus.VOID) return invoice;

    if (!reason.trim()) {
      throw new AppError('INVALID_REQUEST', 'A reason is required to void an invoice.');
    }

    const voided = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VOID, voidedAt: new Date(), voidReason: reason },
    });

    await this.activity.record(principal, {
      action: 'billing.invoice.voided',
      customerId: invoice.customerId,
      resourceType: 'invoice',
      resourceId: invoiceId,
      oldValue: { status: invoice.status },
      newValue: { status: 'VOID', reason },
    });

    return voided;
  }

  /**
   * Issues a credit note reversing an invoice.
   *
   * A credit note takes its own number from the same sequence — it is a tax
   * document in its own right — and carries the original's lines negated, so the
   * two sum to zero.
   */
  async creditNoteFor(principal: Principal, invoiceId: string, reason: string) {
    const original = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: true },
    });
    if (!original) throw notFound('invoice');

    if (original.status === InvoiceStatus.VOID) {
      throw new AppError('CONFLICT', 'That invoice was voided, so there is nothing to credit.');
    }

    const credit = await this.issue(principal, {
      customerId: original.customerId,
      lines: original.lines.map((line) => ({
        description: `Credit: ${line.description}`,
        unitPriceInPaise: -line.unitPriceInPaise,
        quantity: line.quantity,
        sacCode: line.sacCode,
        gstRateBps: line.gstRateBps,
      })),
    });

    await this.activity.record(principal, {
      action: 'billing.credit_note.issued',
      customerId: original.customerId,
      resourceType: 'invoice',
      resourceId: credit.id,
      newValue: { against: original.invoiceNumber, reason },
    });

    return credit;
  }

  /**
   * Confirms the sequence has no gaps, for the admin billing view.
   *
   * Cheap to run and worth surfacing: a gap means either a bug here or a row
   * removed by hand, and both are things to find before an audit does.
   */
  async auditSequence(financialYear: string): Promise<{
    financialYear: string;
    issued: number;
    expected: number;
    missing: number[];
    duplicates: string[];
  }> {
    const invoices = await this.prisma.invoice.findMany({
      where: { financialYear },
      select: { serialNumber: true, invoiceNumber: true },
      orderBy: { serialNumber: 'asc' },
    });

    const serials = invoices
      .map((i) => i.serialNumber)
      .filter((n): n is number => n !== null);

    const seen = new Set<number>();
    const duplicates: string[] = [];
    for (const invoice of invoices) {
      if (invoice.serialNumber === null) continue;
      if (seen.has(invoice.serialNumber)) duplicates.push(invoice.invoiceNumber ?? '');
      seen.add(invoice.serialNumber);
    }

    const highest = serials.length > 0 ? Math.max(...serials) : 0;
    const missing: number[] = [];
    for (let n = 1; n <= highest; n += 1) {
      if (!seen.has(n)) missing.push(n);
    }

    return { financialYear, issued: serials.length, expected: highest, missing, duplicates };
  }

  /**
   * Staff invoice list. Paginated with a hard ceiling, like every list endpoint.
   */
  async list(options: {
    customerId?: string;
    status?: InvoiceStatus;
    financialYear?: string;
    skip?: number;
    take?: number;
  }) {
    const take = Math.min(Math.max(options.take ?? 25, 1), 100);
    const skip = Math.max(options.skip ?? 0, 0);

    const where: Prisma.InvoiceWhereInput = {
      ...(options.customerId ? { customerId: options.customerId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.financialYear ? { financialYear: options.financialYear } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        skip,
        take,
        // Serial order, not creation order: an auditor reads the sequence, and
        // two invoices issued in the same millisecond would otherwise shuffle.
        orderBy: [{ financialYear: 'desc' }, { serialNumber: 'desc' }, { createdAt: 'desc' }],
        include: { lines: true },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items, total };
  }

  async findForAdmin(id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
    if (!invoice) throw notFound('invoice');
    return invoice;
  }

  /** Legal entity details, from system settings once those exist. */
  private async supplierParty(): Promise<Party> {
    return {
      stateCode: process.env.WEBEDGE_STATE_CODE ?? '27',
      gstin: process.env.WEBEDGE_GSTIN ?? null,
    };
  }
}
