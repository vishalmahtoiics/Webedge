import { Module } from '@nestjs/common';
import { PlansController, RenewalsController, SubscriptionsController } from './plans.controller';
import { CustomerPlansController } from './customer-plans.controller';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { PlanLimitsService } from './plan-limits.service';
import { RenewalsService } from './renewals.service';
import { RenewalsScheduler } from './renewals.scheduler';
import { BillingModule } from '../billing/billing.module';
import { ActivityService } from '../activity/activity.service';

@Module({
  imports: [BillingModule],
  controllers: [
    PlansController,
    SubscriptionsController,
    RenewalsController,
    CustomerPlansController,
  ],
  providers: [
    PlansService,
    SubscriptionsService,
    PlanLimitsService,
    RenewalsService,
    RenewalsScheduler,
    ActivityService,
  ],
  exports: [PlansService, SubscriptionsService, PlanLimitsService, RenewalsService],
})
export class PlansModule {}
