import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { CustomerInvoicesController } from './customer-invoices.controller';
import { InvoiceService } from './invoice.service';
import { CustomerInvoicesService } from './customer-invoices.service';
import { TenantScope } from '../common/tenant-scope';
import { ActivityService } from '../activity/activity.service';

@Module({
  controllers: [BillingController, CustomerInvoicesController],
  providers: [InvoiceService, CustomerInvoicesService, TenantScope, ActivityService],
  exports: [InvoiceService],
})
export class BillingModule {}
