import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put,
} from '@nestjs/common';
import { Realm } from '@prisma/client';
import { AdminDnsService } from './admin-dns.service';
import { DnsRecordDto } from './dto/dns.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

/** Staff-side DNS. Separate from the customer path, and from its tenancy. */
@Controller('admin/domains/:domainId/dns')
@RequireRealm(Realm.ADMIN)
export class AdminDnsController {
  constructor(private readonly dns: AdminDnsService) {}

  @Get()
  @RequirePermissions('admin.hosting_services')
  list(@Param('domainId', ParseUUIDPipe) domainId: string) {
    return this.dns.list(domainId);
  }

  @Post()
  @RequirePermissions('admin.hosting_services')
  create(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Body() dto: DnsRecordDto,
  ) {
    return this.dns.create(principal, domainId, dto);
  }

  @Put('records/:recordId')
  @RequirePermissions('admin.hosting_services')
  update(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) _domainId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: DnsRecordDto,
  ) {
    return this.dns.update(principal, recordId, dto);
  }

  @Delete('records/:recordId')
  @RequirePermissions('admin.hosting_services')
  @HttpCode(204)
  async remove(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) _domainId: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
  ): Promise<void> {
    await this.dns.remove(principal, recordId);
  }
}
