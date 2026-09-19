import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { AdminDomainsService } from './admin-domains.service';
import { AdminDomainsWriteService } from './admin-domains.write';
import { ClaimDomainDto, CreateDomainDto, ListDomainsQueryDto } from './dto/admin-domains.dto';
import {
  CurrentUser, RequirePermissions, RequireRealm,
} from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

/**
 * Staff-only. Reads local state: what a sync last stored plus what has been
 * sold. It never calls the provider — a page load that fans out to an upstream
 * API is one slow account away from a portal that will not open.
 */
@Controller('admin/domains')
@RequireRealm(Realm.ADMIN)
export class AdminDomainsController {
  constructor(
    private readonly domains: AdminDomainsService,
    private readonly write: AdminDomainsWriteService,
  ) {}

  @Get()
  @RequirePermissions('admin.hosting_services')
  list(@Query() query: ListDomainsQueryDto) {
    return this.domains.list(query);
  }

  /** Attaches a domain found on a provider account to a customer. */
  @Post('claim')
  @RequirePermissions('admin.hosting_services')
  claim(@CurrentUser() principal: Principal, @Body() dto: ClaimDomainDto) {
    return this.write.claim(principal, dto.discoveredId, dto.customerId);
  }

  /** Adds a domain registered elsewhere. */
  @Post()
  @RequirePermissions('admin.hosting_services')
  create(@CurrentUser() principal: Principal, @Body() dto: CreateDomainDto) {
    return this.write.create(principal, dto);
  }

  @Delete(':id')
  @RequirePermissions('admin.hosting_services')
  @HttpCode(204)
  async detach(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.write.detach(principal, id);
  }
}
