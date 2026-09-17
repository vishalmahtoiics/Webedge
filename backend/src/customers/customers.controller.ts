import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { CustomersService } from './customers.service';
import {
  AssignPlanDto, CreateCustomerDto, ListCustomersQueryDto, SetCustomerStatusDto,
} from './dto/customer.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

@Controller('admin/customers')
@RequireRealm(Realm.ADMIN)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

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

  @Post(':id/plan')
  @RequirePermissions('admin.hosting_services')
  assignPlan(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPlanDto,
  ) {
    return this.customers.assignPlan(principal, id, dto.planId);
  }
}
