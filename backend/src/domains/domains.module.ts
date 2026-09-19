import { Module } from '@nestjs/common';
import { AdminDomainsController } from './admin-domains.controller';
import { AdminDomainsService } from './admin-domains.service';
import { AdminDomainsWriteService } from './admin-domains.write';
import { ActivityService } from '../activity/activity.service';

@Module({
  controllers: [AdminDomainsController],
  providers: [AdminDomainsService, AdminDomainsWriteService, ActivityService],
  exports: [AdminDomainsService, AdminDomainsWriteService],
})
export class DomainsModule {}
