import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ActivityService } from '../src/activity/activity.service';
import { InvoiceService, financialYearFor, formatInvoiceNumber } from '../src/billing/invoice.service';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * Invoice numbering, against the real database.
 *
 * GST requires a consecutive, unique, gapless serial per financial year. The
 * failure mode worth testing is concurrency: a read-then-write allocator looks
 * perfectly correct in a single-threaded test and hands two simultaneous
 * invoices the same number in production. Only real concurrent transactions
 * show that, so this suite fires them.
 */
describe('invoice numbering', () => {
  const prisma = new PrismaClient() as PrismaService;
  const service = new InvoiceService(prisma, new ActivityService(prisma));

  const suffix = Date.now().toString(36);
  let customerId: string;

  const line = (rupees: number) => ({
    description: 'Business hosting, 1 year',
    unitPriceInPaise: rupees * 100,
    quantity: 1,
  });

  beforeAll(async () => {
    await prisma.$connect();

    // auditSequence spans the whole financial year by design — that is what an
    // auditor checks — so this suite only means anything if it owns the whole
    // invoice table. Anything left behind, by an earlier failed run or by hand,
    // would show up as a gap this run did not cause, or collide with a number
    // it allocates. Clearing the table and the counter together is what keeps
    // the two consistent; clearing only one produces exactly that collision.
    await prisma.invoice.deleteMany({});
    await prisma.invoiceSequence.deleteMany({});
    await prisma.customer.deleteMany({ where: { email: { endsWith: '@isolation.test' } } });
    const customer = await prisma.customer.create({
      data: {
        fullName: 'Invoice Test Co',
        email: `invoices-${suffix}@isolation.test`,
        status: 'ACTIVE',
        billingState: '29',
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.$disconnect();
  });

  describe('financial year', () => {
    /**
     * India's financial year runs 1 April to 31 March. Using the calendar year
     * would restart the sequence three months early and produce two invoices
     * with the same number.
     */
    it('puts January in the year that started the previous April', () => {
      expect(financialYearFor(new Date('2027-01-15T00:00:00Z'))).toBe('2026-27');
      expect(financialYearFor(new Date('2027-03-31T23:59:59Z'))).toBe('2026-27');
    });

    it('rolls over on 1 April', () => {
      expect(financialYearFor(new Date('2026-03-31T23:59:59Z'))).toBe('2025-26');
      expect(financialYearFor(new Date('2026-04-01T00:00:00Z'))).toBe('2026-27');
    });

    it('formats a padded, sortable number', () => {
      expect(formatInvoiceNumber('2026-27', 1)).toBe('WEB/2026-27/00001');
      expect(formatInvoiceNumber('2026-27', 42_195)).toBe('WEB/2026-27/42195');
    });
  });

  describe('issuing', () => {
    it('records the computed totals on the invoice', async () => {
      const invoice = await service.issue(undefined, { customerId, lines: [line(4499)] });

      // Customer is in 29, supplier in 27, so this is inter-state.
      expect(invoice.taxKind).toBe('IGST');
      expect(invoice.igstInPaise).toBe(80_982);
      expect(invoice.totalInPaise).toBe(530_900);
      expect(invoice.lines).toHaveLength(1);
      expect(invoice.invoiceNumber).toMatch(/^WEB\/\d{4}-\d{2}\/\d{5}$/);
    });

    it('snapshots the parties rather than referring to them', async () => {
      const invoice = await service.issue(undefined, { customerId, lines: [line(999)] });

      expect(invoice.customerName).toBe('Invoice Test Co');
      expect(invoice.customerStateCode).toBe('29');
      expect(invoice.supplierStateCode).toBe('27');
      expect(invoice.placeOfSupply).toBe('29');
    });

    it('refuses an invoice with no lines', async () => {
      await expect(service.issue(undefined, { customerId, lines: [] })).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
    });

    it('increments the serial for each invoice', async () => {
      const first = await service.issue(undefined, { customerId, lines: [line(100)] });
      const second = await service.issue(undefined, { customerId, lines: [line(100)] });

      expect(second.serialNumber).toBe(first.serialNumber! + 1);
    });
  });

  /**
   * The reason this suite exists. Twenty invoices issued at once must produce
   * twenty distinct, consecutive numbers — no duplicates, no gaps, nothing lost
   * to a lost update.
   */
  describe('concurrent issuance', () => {
    it('gives every concurrent invoice a distinct, consecutive number', async () => {
      const before = await prisma.invoice.count({ where: { customerId } });

      const issued = await Promise.all(
        Array.from({ length: 20 }, () => service.issue(undefined, { customerId, lines: [line(500)] })),
      );

      const serials = issued.map((i) => i.serialNumber!).sort((a, b) => a - b);

      expect(new Set(serials).size, 'duplicate serial numbers were allocated').toBe(20);

      // Consecutive with no holes.
      for (let i = 1; i < serials.length; i += 1) {
        expect(serials[i]).toBe(serials[i - 1]! + 1);
      }

      expect(await prisma.invoice.count({ where: { customerId } })).toBe(before + 20);
    });

    it('allocates unique invoice numbers, not just unique serials', async () => {
      const numbers = (
        await prisma.invoice.findMany({ where: { customerId }, select: { invoiceNumber: true } })
      ).map((i) => i.invoiceNumber);

      expect(new Set(numbers).size).toBe(numbers.length);
    });

    it('reports no gaps or duplicates in the sequence', async () => {
      const audit = await service.auditSequence(financialYearFor(new Date()));

      expect(audit.duplicates).toEqual([]);
      expect(audit.missing).toEqual([]);
      expect(audit.issued).toBe(audit.expected);
    });
  });

  describe('voiding and credit notes', () => {
    const principal = {
      realm: 'ADMIN' as const,
      userId: '00000000-0000-4000-8000-00000000000a',
      email: 'admin@webedgesolution.com',
      roleId: '00000000-0000-4000-8000-00000000000b',
      roleName: 'SUPER_ADMIN',
      permissions: new Set<string>(),
    };

    /** A deleted invoice leaves a gap, which reads exactly like a suppressed one. */
    it('keeps the number when an invoice is voided', async () => {
      const invoice = await service.issue(undefined, { customerId, lines: [line(250)] });
      const voided = await service.voidInvoice(principal, invoice.id, 'Issued in error');

      expect(voided.status).toBe('VOID');
      expect(voided.invoiceNumber).toBe(invoice.invoiceNumber);
      expect(voided.voidReason).toBe('Issued in error');

      const audit = await service.auditSequence(financialYearFor(new Date()));
      expect(audit.missing).toEqual([]);
    });

    it('requires a reason to void', async () => {
      const invoice = await service.issue(undefined, { customerId, lines: [line(250)] });
      await expect(service.voidInvoice(principal, invoice.id, '   ')).rejects.toMatchObject({
        response: { code: 'INVALID_REQUEST' },
      });
    });

    it('refuses to void a paid invoice, directing to a credit note', async () => {
      const invoice = await service.issue(undefined, { customerId, lines: [line(250)] });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });

      await expect(service.voidInvoice(principal, invoice.id, 'oops')).rejects.toMatchObject({
        response: { code: 'CONFLICT' },
      });
    });

    it('issues a credit note that exactly reverses the original', async () => {
      const invoice = await service.issue(undefined, { customerId, lines: [line(1000), line(250)] });
      const credit = await service.creditNoteFor(principal, invoice.id, 'Service not delivered');

      expect(credit.totalInPaise).toBe(-invoice.totalInPaise);
      expect(credit.igstInPaise).toBe(-invoice.igstInPaise);
      expect(credit.subtotalInPaise).toBe(-invoice.subtotalInPaise);

      // Its own number, from the same sequence: a credit note is a tax document
      // in its own right, not an annotation on the invoice.
      expect(credit.invoiceNumber).not.toBe(invoice.invoiceNumber);
      expect(credit.serialNumber).toBe(invoice.serialNumber! + 1);
    });

    /**
     * Rule 53(1A) CGST Rules: a credit note carries the number and date of the
     * invoice it revises. Without this it is a document for a negative amount
     * that nothing identifies as a credit note — which is how one ends up
     * displayed as an invoice owing money back.
     */
    it('marks a credit note as one and records what it revises', async () => {
      const invoice = await service.issue(undefined, { customerId, lines: [line(700)] });
      const credit = await service.creditNoteFor(principal, invoice.id, 'Service not delivered');

      expect(invoice.kind).toBe('INVOICE');
      expect(credit.kind).toBe('CREDIT_NOTE');
      expect(credit.againstInvoiceId).toBe(invoice.id);
      expect(credit.againstInvoiceNumber).toBe(invoice.invoiceNumber);
      expect(credit.againstInvoiceDate?.getTime()).toBe(invoice.issuedAt?.getTime());
    });

    /** Crediting a credit note would produce a positive document that reads as
     *  a second invoice for the same supply. */
    it('refuses to credit a credit note', async () => {
      const invoice = await service.issue(undefined, { customerId, lines: [line(700)] });
      const credit = await service.creditNoteFor(principal, invoice.id, 'Service not delivered');

      await expect(
        service.creditNoteFor(principal, credit.id, 'again'),
      ).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
    });

    it('refuses to credit an invoice that was already voided', async () => {
      const invoice = await service.issue(undefined, { customerId, lines: [line(250)] });
      await service.voidInvoice(principal, invoice.id, 'Issued in error');

      await expect(
        service.creditNoteFor(principal, invoice.id, 'duplicate'),
      ).rejects.toMatchObject({ response: { code: 'CONFLICT' } });
    });
  });
});
