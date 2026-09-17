import { Controller, Get } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { PlansService } from './plans.service';
import { RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';

/**
 * The plan catalogue a customer sees.
 *
 * Read-only, and served from a select list that omits `providerProduct` — naming
 * the upstream product would say who the provider is.
 */
@Controller('customer/plans')
@RequireRealm(Realm.CUSTOMER)
export class CustomerPlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @RequirePermissions('billing.view')
  list() {
    return this.plans.listPublic();
  }
}
