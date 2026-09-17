import { Controller, Get, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { ActivityReadService } from './activity-read.service';
import { PageQueryDto } from './dto/activity.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

/** A customer's own activity. Their tenant, their CUSTOMER-visible rows, only. */
@Controller('customer/activity')
@RequireRealm(Realm.CUSTOMER)
export class CustomerActivityController {
  constructor(private readonly activity: ActivityReadService) {}

  @Get()
  @RequirePermissions('activity.view')
  list(@CurrentUser() principal: Principal, @Query() query: PageQueryDto) {
    return this.activity.listForCustomer(principal, query);
  }
}
