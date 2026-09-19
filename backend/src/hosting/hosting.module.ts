import { Module } from '@nestjs/common';
import {
  AdminDatabasesController, AdminDnsPublishController, AdminMailboxesController,
} from './hosting.controller';
import { ProviderHostingService } from './provider-hosting.service';
import { ProvidersModule } from '../providers/providers.module';
import { ActivityService } from '../activity/activity.service';

@Module({
  imports: [ProvidersModule],
  controllers: [AdminDatabasesController, AdminMailboxesController, AdminDnsPublishController],
  providers: [ProviderHostingService, ActivityService],
  exports: [ProviderHostingService],
})
export class HostingModule {}
