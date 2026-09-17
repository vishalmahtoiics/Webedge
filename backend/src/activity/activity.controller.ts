import { Controller, Get, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { ActivityReadService } from './activity-read.service';
import { ActivityQueryDto } from './dto/activity.dto';
import { RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';

/**
 * The staff view of the audit trail. Read-only, because the table is
 * append-only at the database level — there is nothing here that could edit a
 * row even if someone wrote the handler.
 */
@Controller('admin/activity')
@RequireRealm(Realm.ADMIN)
export class ActivityController {
  constructor(private readonly activity: ActivityReadService) {}

  @Get()
  @RequirePermissions('admin.logs')
  list(@Query() query: ActivityQueryDto) {
    return this.activity.listForStaff(query);
  }

  /**
   * Sign-ins, credential changes, role changes and impersonation. A separate
   * permission because it answers "who has access to what", which is a different
   * question from "what happened to this customer's website".
   */
  @Get('security')
  @RequirePermissions('admin.security_logs')
  listSecurity(@Query() query: ActivityQueryDto) {
    return this.activity.listSecurityForStaff(query);
  }
}
