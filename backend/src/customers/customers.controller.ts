import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { CustomersService } from './customers.service';
import { SubscriptionsService } from '../plans/subscriptions.service';
import {
  AssignPlanDto, CreateCustomerDto, ListCustomersQueryDto, SetCustomerStatusDto,
} from './dto/customer.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

@Controller('admin/customers')
@RequireRealm(Realm.ADMIN)
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Get()
  @RequirePermissions('admin.customers')
  list(@Query() query: ListCustomersQueryDto) {
    return this.customers.list(query);
  }

  @Get(':id')
  @RequirePermissions('admin.customers')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  @Post()
  @RequirePermissions('admin.customers')
  create(@CurrentUser() principal: Principal, @Body() dto: CreateCustomerDto) {
    return this.customers.create(principal, dto);
  }

  // Suspension and termination sit behind their own permission, which
  // SUPPORT_STAFF does not hold.
  @Patch(':id/status')
  @RequirePermissions('admin.customers.suspend')
  @HttpCode(204)
  async setStatus(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCustomerStatusDto,
  ): Promise<void> {
    await this.customers.setStatus(principal, id, dto.status, dto.reason);
  }

  // Kept at this address because it is where staff assign a plan from, but the
  // lifecycle and its date arithmetic belong to SubscriptionsService.
  @Post(':id/plan')
  @RequirePermissions('admin.hosting_services')
  assignPlan(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPlanDto,
  ) {
    return this.subscriptions.subscribe(principal, id, dto.planId);
  }
}
