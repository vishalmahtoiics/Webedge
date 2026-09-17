import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { TlsInspector, type TlsReport } from './tls-inspector';
import { TenantScope } from '../common/tenant-scope';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

/**
 * SSL status for a customer's domain.
 *
 * The hostname comes from the owned domain record, never from the request, so
 * this cannot be used to point the checker at an arbitrary host — the SSRF guard
 * is the second line of defence rather than the only one.
 */
@Controller('customer/domains/:domainId/ssl')
@RequireRealm(Realm.CUSTOMER)
export class SslController {
  constructor(
    private readonly inspector: TlsInspector,
    private readonly scope: TenantScope,
  ) {}

  @Get()
  @RequirePermissions('ssl.view')
  async check(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ): Promise<TlsReport> {
    const domain = await this.scope.findOwned<{ name: string }>(
      principal,
      'domain',
      domainId,
      'domain',
    );
    return this.inspector.inspect(domain.name);
  }
}
