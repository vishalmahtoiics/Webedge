import { Module } from '@nestjs/common';
import { DnsController } from './dns.controller';
import { DnsService } from './dns.service';
import { TenantScope } from '../common/tenant-scope';
import { ActivityService } from '../activity/activity.service';

@Module({
  controllers: [DnsController],
  providers: [DnsService, TenantScope, ActivityService],
})
export class DnsModule {}
