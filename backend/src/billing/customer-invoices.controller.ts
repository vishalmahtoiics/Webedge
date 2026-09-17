import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CustomerInvoicesService } from './customer-invoices.service';
import { invoiceView } from './invoice.view';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  take?: number;
}

/** A customer's own invoices. Read-only: nobody edits a tax document. */
@Controller('customer/invoices')
@RequireRealm(Realm.CUSTOMER)
export class CustomerInvoicesController {
  constructor(private readonly invoices: CustomerInvoicesService) {}

  @Get()
  @RequirePermissions('billing.invoice')
  async list(@CurrentUser() principal: Principal, @Query() query: PageQueryDto) {
    const { items, total } = await this.invoices.list(principal, query);
    return { items: items.map(invoiceView), total };
  }

  @Get(':id')
  @RequirePermissions('billing.invoice')
  async get(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return invoiceView(await this.invoices.get(principal, id));
  }
}
