import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { DnsService } from './dns.service';
import { DnsRecordDto } from './dto/dns.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

@Controller('customer/domains/:domainId/dns')
@RequireRealm(Realm.CUSTOMER)
export class DnsController {
  constructor(private readonly dns: DnsService) {}

  @Get()
  @RequirePermissions('dns.view')
  list(@CurrentUser() principal: Principal, @Param('domainId', ParseUUIDPipe) domainId: string) {
    return this.dns.list(principal, domainId);
  }

  @Post()
  @RequirePermissions('dns.create')
  create(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Body() dto: DnsRecordDto,
  ) {
    return this.dns.create(principal, domainId, dto);
  }

  @Put('records/:recordId')
  @RequirePermissions('dns.update')
  update(
    @CurrentUser() principal: Principal,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: DnsRecordDto,
  ) {
    return this.dns.update(principal, recordId, dto);
  }

  @Delete('records/:recordId')
  @RequirePermissions('dns.delete')
  @HttpCode(204)
  async remove(
    @CurrentUser() principal: Principal,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ): Promise<void> {
    await this.dns.remove(principal, recordId);
  }
}
