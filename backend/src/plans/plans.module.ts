import { Module } from '@nestjs/common';
import { PlansController, SubscriptionsController } from './plans.controller';
import { CustomerPlansController } from './customer-plans.controller';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { PlanLimitsService } from './plan-limits.service';
import { BillingModule } from '../billing/billing.module';
import { ActivityService } from '../activity/activity.service';

@Module({
  imports: [BillingModule],
  controllers: [PlansController, SubscriptionsController, CustomerPlansController],
  providers: [PlansService, SubscriptionsService, PlanLimitsService, ActivityService],
  exports: [PlansService, SubscriptionsService, PlanLimitsService],
})
export class PlansModule {}
