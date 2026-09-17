import { Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailDomainsService } from './mail-domains.service';
import { MailboxesService } from './mailboxes.service';
import { AliasesService } from './aliases.service';
import { PlanLimitsService } from '../plans/plan-limits.service';
import { TenantScope } from '../common/tenant-scope';
import { ActivityService } from '../activity/activity.service';

@Module({
  controllers: [MailController],
  providers: [
    MailDomainsService,
    MailboxesService,
    AliasesService,
    PlanLimitsService,
    TenantScope,
    ActivityService,
  ],
  exports: [MailDomainsService, MailboxesService, AliasesService],
})
export class MailModule {}
