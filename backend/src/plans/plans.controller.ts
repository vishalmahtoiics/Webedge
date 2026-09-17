import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import {
  CancelSubscriptionDto, ChangePlanDto, CreatePlanDto, ListPlansQueryDto, SetPlanActiveDto,
  SubscribeDto, UpdatePlanDto,
} from './dto/plans.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

@Controller('admin/plans')
@RequireRealm(Realm.ADMIN)
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @RequirePermissions('admin.plans')
  list(@Query() query: ListPlansQueryDto) {
    return this.plans.list(query);
  }

  @Get(':id')
  @RequirePermissions('admin.plans')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.get(id);
  }

  @Post()
  @RequirePermissions('admin.plans')
  create(@CurrentUser() principal: Principal, @Body() dto: CreatePlanDto) {
    return this.plans.create(principal, dto);
  }

  @Patch(':id')
  @RequirePermissions('admin.plans')
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.plans.update(principal, id, dto);
  }

  /**
   * Withdraw or reinstate. There is no delete: a plan that has been sold is
   * cited by subscriptions and by the invoices that charged for it.
   */
  @Patch(':id/active')
  @RequirePermissions('admin.plans')
  setActive(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPlanActiveDto,
  ) {
    return this.plans.setActive(principal, id, dto.isActive);
  }
}

@Controller('admin/subscriptions')
@RequireRealm(Realm.ADMIN)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post()
  @RequirePermissions('admin.hosting_services')
  subscribe(@CurrentUser() principal: Principal, @Body() dto: SubscribeDto) {
    return this.subscriptions.subscribe(principal, dto.customerId, dto.planId);
  }

  /** Renewal issues an invoice, so it sits behind the billing permission. */
  @Post(':id/renew')
  @RequirePermissions('admin.billing')
  renew(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.renew(principal, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('admin.hosting_services')
  cancel(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.subscriptions.cancel(principal, id, dto.reason);
  }

  /** A plan change credits the unused period and invoices, so: billing. */
  @Post(':id/plan')
  @RequirePermissions('admin.billing')
  changePlan(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangePlanDto,
  ) {
    return this.subscriptions.changePlan(principal, id, dto.planId);
  }
}
