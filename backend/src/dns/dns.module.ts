import { Module } from '@nestjs/common';
import { DnsController } from './dns.controller';
import { AdminDnsController } from './admin-dns.controller';
import { DnsService } from './dns.service';
import { AdminDnsService } from './admin-dns.service';
import { TenantScope } from '../common/tenant-scope';
import { ActivityService } from '../activity/activity.service';

@Module({
  controllers: [DnsController, AdminDnsController],
  providers: [DnsService, AdminDnsService, TenantScope, ActivityService],
})
export class DnsModule {}
