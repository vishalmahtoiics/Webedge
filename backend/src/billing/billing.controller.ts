import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { InvoiceService, financialYearFor } from './invoice.service';
import { invoiceView } from './invoice.view';
import { IssueInvoiceDto, ListInvoicesQueryDto, ReasonDto } from './dto/billing.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import { invalidRequest } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * Staff billing.
 *
 * Note what is missing: there is no route that edits an issued invoice and none
 * that deletes one. Both would break the serial sequence, and a gap in it is
 * what an auditor asks about. Correction is void plus credit note, which is why
 * those are the only two mutations here.
 */
@Controller('admin/billing')
@RequireRealm(Realm.ADMIN)
export class BillingController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get('invoices')
  @RequirePermissions('admin.billing')
  async list(@Query() query: ListInvoicesQueryDto) {
    const { items, total } = await this.invoices.list(query);
    return { items: items.map(invoiceView), total };
  }

  @Get('invoices/:id')
  @RequirePermissions('admin.billing')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return invoiceView(await this.invoices.findForAdmin(id));
  }

  @Post('invoices')
  @RequirePermissions('admin.billing')
  async issue(@CurrentUser() principal: Principal, @Body() dto: IssueInvoiceDto) {
    return invoiceView(await this.invoices.issue(principal, dto));
  }

  @Post('invoices/:id/void')
  @RequirePermissions('admin.billing')
  async void(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return invoiceView(await this.invoices.voidInvoice(principal, id, dto.reason));
  }

  /**
   * Behind `admin.billing.refund` rather than `admin.billing`: a credit note
   * reduces what was charged, which is the money-moving half of billing and not
   * something every staff role should hold.
   */
  @Post('invoices/:id/credit-note')
  @RequirePermissions('admin.billing.refund')
  async creditNote(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return invoiceView(await this.invoices.creditNoteFor(principal, id, dto.reason));
  }

  /**
   * Gap check for a financial year. Worth surfacing in the UI rather than
   * leaving as a script someone remembers to run: a gap means either a bug or a
   * row removed by hand, and both are things to find before an audit does.
   */
  @Get('sequence')
  @RequirePermissions('admin.billing')
  audit(@Query('financialYear') financialYear?: string) {
    const year = financialYear ?? financialYearFor(new Date());
    if (!/^\d{4}-\d{2}$/.test(year)) {
      throw invalidRequest('Use a financial year like 2026-27.');
    }
    return this.invoices.auditSequence(year);
  }
}
