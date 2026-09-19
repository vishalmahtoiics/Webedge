import { Controller, Get, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { AdminDomainsService } from './admin-domains.service';
import { ListDomainsQueryDto } from './dto/admin-domains.dto';
import { RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';

/**
 * Staff-only. Reads local state: what a sync last stored plus what has been
 * sold. It never calls the provider — a page load that fans out to an upstream
 * API is one slow account away from a portal that will not open.
 */
@Controller('admin/domains')
@RequireRealm(Realm.ADMIN)
export class AdminDomainsController {
  constructor(private readonly domains: AdminDomainsService) {}

  @Get()
  @RequirePermissions('admin.hosting_services')
  list(@Query() query: ListDomainsQueryDto) {
    return this.domains.list(query);
  }
}
