import { Injectable } from '@nestjs/common';
import { Invoice, InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantScope } from '../common/tenant-scope';
import { notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * A customer's own invoices.
 *
 * Separate from `InvoiceService` because the two have different rules about what
 * is addressable. Staff read by id; a customer reads only through `TenantScope`,
 * so the tenant comes from the session and another customer's invoice id is
 * indistinguishable from one that does not exist.
 *
 * Drafts are excluded everywhere here. A draft has no number, is not a tax
 * document, and showing one would mean a customer sees an amount that has not
 * been charged — and an invoice that later changes.
 */
@Injectable()
export class CustomerInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: TenantScope,
  ) {}

  async list(principal: Principal, options: { skip?: number; take?: number }) {
    return this.scope.listOwned<Invoice>(principal, 'invoice', {
      ...options,
      where: { status: { not: InvoiceStatus.DRAFT } },
      orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(principal: Principal, id: string) {
    // Ownership first, through the scope — this is the check that matters, and
    // it reports a foreign id as not found.
    const owned = await this.scope.findOwned<Invoice>(principal, 'invoice', id, 'invoice');

    // A draft is not addressable by the customer it is for. Reported as missing
    // rather than forbidden, for the same reason a foreign id is: the answer
    // must not distinguish "yours but not yet issued" from "not yours".
    if (owned.status === InvoiceStatus.DRAFT) throw notFound('invoice');

    // Ownership is established, so the second read is by id alone — it exists to
    // pull the lines, which `findOwned` deliberately does not fetch.
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: owned.id },
      include: { lines: true },
    });
    if (!invoice) throw notFound('invoice');

    return invoice;
  }
}
