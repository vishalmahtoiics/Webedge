import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { CustomerActivityController } from './customer-activity.controller';
import { ActivityReadService } from './activity-read.service';
import { ActivityService } from './activity.service';

@Module({
  controllers: [ActivityController, CustomerActivityController],
  providers: [ActivityReadService, ActivityService],
  exports: [ActivityService, ActivityReadService],
})
export class ActivityModule {}
