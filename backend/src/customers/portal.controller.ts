import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { DashboardService } from './dashboard.service';
import { TenantScope } from '../common/tenant-scope';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { CustomerPrincipal, Principal } from '../common/principal';
import { unauthenticated } from '../common/errors';

class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  take?: number;
}

/**
 * The customer portal's own data.
 *
 * Every route is realm-restricted to CUSTOMER and scoped through TenantScope, so
 * the tenant comes from the session and a resource id belonging to someone else
 * is reported as not found.
 */
@Controller('customer')
@RequireRealm(Realm.CUSTOMER)
export class PortalController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly scope: TenantScope,
  ) {}

  // The whole dashboard in one call, so the page does not make six round trips.
  @Get('dashboard')
  @RequirePermissions('dashboard.view')
  getDashboard(@CurrentUser() principal: Principal) {
    return this.dashboard.build(PortalController.asCustomer(principal));
  }

  @Get('websites')
  @RequirePermissions('websites.view')
  listWebsites(@CurrentUser() principal: Principal, @Query() query: PageQueryDto) {
    return this.scope.listOwned(principal, 'website', query);
  }

  @Get('websites/:id')
  @RequirePermissions('websites.view')
  getWebsite(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.scope.findOwned(principal, 'website', id, 'website');
  }

  /**
   * The plan the customer is on, with its renewal date.
   *
   * Read through TenantScope like everything else here, then re-read by id to
   * pull the plan's name — `findOwned` deliberately does not fetch relations.
   * Returns null rather than 404 when there is no subscription: having no plan
   * is a state, not a missing resource.
   */
  @Get('subscription')
  @RequirePermissions('billing.view')
  async getSubscription(@CurrentUser() principal: Principal) {
    const { items } = await this.scope.listOwned<{ id: string; status: string }>(
      principal,
      'subscription',
      { take: 1, where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } },
    );
    const current = items[0];
    if (!current) return { subscription: null };

    const subscription = await this.dashboard.subscriptionSummary(current.id);
    return { subscription };
  }

  @Get('domains')
  @RequirePermissions('domains.view')
  listDomains(@CurrentUser() principal: Principal, @Query() query: PageQueryDto) {
    return this.scope.listOwned(principal, 'domain', query);
  }

  @Get('notifications')
  @RequirePermissions('dashboard.view')
  listNotifications(@CurrentUser() principal: Principal, @Query() query: PageQueryDto) {
    return this.scope.listOwned(principal, 'notification', query);
  }

  /**
   * The realm guard already rejects a staff session, so this is the type
   * narrowing rather than the security control — but it fails closed if that
   * guard is ever removed from this controller.
   */
  private static asCustomer(principal: Principal): CustomerPrincipal {
    if (principal.realm !== Realm.CUSTOMER) throw unauthenticated();
    return principal;
  }
}
