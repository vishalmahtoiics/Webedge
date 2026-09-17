import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { PortalController } from './portal.controller';
import { CustomersService } from './customers.service';
import { DashboardService } from './dashboard.service';
import { TenantScope } from '../common/tenant-scope';
import { ActivityService } from '../activity/activity.service';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [PlansModule],
  controllers: [CustomersController, PortalController],
  providers: [CustomersService, DashboardService, TenantScope, ActivityService],
  exports: [CustomersService],
})
export class CustomersModule {}
