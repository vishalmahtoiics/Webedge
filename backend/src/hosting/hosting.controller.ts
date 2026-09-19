import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Realm } from '@prisma/client';
import { ProviderHostingService } from './provider-hosting.service';
import {
  ChangeDatabasePasswordDto, CreateDatabaseDto, CreateMailboxDto,
} from './dto/hosting.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

/**
 * Databases on a website's provider account.
 *
 * Staff-only and deliberately not a customer route. Creating a database is a
 * write to a live provider account with no sandbox behind it, and the guard
 * that decides whether that is allowed is not something a customer should be
 * able to reach at all.
 */
@Controller('admin/websites/:websiteId/databases')
@RequireRealm(Realm.ADMIN)
export class AdminDatabasesController {
  constructor(private readonly hosting: ProviderHostingService) {}

  @Get()
  @RequirePermissions('admin.hosting_services')
  list(@Param('websiteId', ParseUUIDPipe) websiteId: string) {
    return this.hosting.listDatabases(websiteId);
  }

  @Post()
  @RequirePermissions('admin.hosting_services')
  create(
    @CurrentUser() principal: Principal,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() dto: CreateDatabaseDto,
  ) {
    return this.hosting.createDatabase(principal, websiteId, dto);
  }

  /** The name is the provider's full name, as its own list returns it. */
  @Delete(':name')
  @RequirePermissions('admin.hosting_services')
  @HttpCode(204)
  async remove(
    @CurrentUser() principal: Principal,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('name') name: string,
  ): Promise<void> {
    await this.hosting.deleteDatabase(principal, websiteId, name);
  }

  @Patch(':name/password')
  @RequirePermissions('admin.hosting_services')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() principal: Principal,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('name') name: string,
    @Body() dto: ChangeDatabasePasswordDto,
  ): Promise<void> {
    await this.hosting.changeDatabasePassword(principal, websiteId, name, dto.password);
  }

  /**
   * A one-time link into the provider's database tool.
   *
   * Fetched on demand and never stored: it authenticates whoever holds it, so
   * a stored copy is a spare key and one in the append-only trail is a spare
   * key nobody can revoke.
   */
  @Get(':name/phpmyadmin')
  @RequirePermissions('admin.hosting_services')
  async phpMyAdmin(
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Param('name') name: string,
  ) {
    return { link: await this.hosting.phpMyAdminLink(websiteId, name) };
  }
}

/**
 * Mailboxes on a provider mail order.
 *
 * Separate from `customer/mail`, which is WebEdge's own Postfix and Dovecot
 * platform. These are the provider's mailboxes, on a mail product the account
 * already pays for, and they work today — the WebEdge platform needs servers
 * that are not deployed. Keeping them apart avoids a screen where half the
 * rows are one system and half the other.
 */
@Controller('admin/provider-accounts/:accountId/mailboxes')
@RequireRealm(Realm.ADMIN)
export class AdminMailboxesController {
  constructor(private readonly hosting: ProviderHostingService) {}

  @Get()
  @RequirePermissions('admin.hosting_services')
  list(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('orderId') orderId: string,
  ) {
    return this.hosting.listMailboxes(accountId, orderId);
  }

  @Post()
  @RequirePermissions('admin.hosting_services')
  create(
    @CurrentUser() principal: Principal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('orderId') orderId: string,
    @Body() dto: CreateMailboxDto,
  ) {
    return this.hosting.createMailbox(principal, accountId, orderId, {
      localPart: dto.localPart,
      password: dto.password,
      customerId: dto.customerId,
    });
  }

  @Delete(':mailboxId')
  @RequirePermissions('admin.hosting_services')
  @HttpCode(204)
  async remove(
    @CurrentUser() principal: Principal,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('mailboxId') mailboxId: string,
    @Query('address') address?: string,
  ): Promise<void> {
    await this.hosting.deleteMailbox(principal, accountId, mailboxId, { address });
  }
}

/** Publishing WebEdge's DNS records to the provider. */
@Controller('admin/domains/:domainId/dns')
@RequireRealm(Realm.ADMIN)
export class AdminDnsPublishController {
  constructor(private readonly hosting: ProviderHostingService) {}

  /**
   * Replaces the provider's zone with WebEdge's records.
   *
   * A replace, not a merge: the panel's copy is the intended state, and
   * appending would leave a record deleted here still live upstream, with
   * neither screen showing the disagreement.
   */
  @Post('publish')
  @RequirePermissions('admin.hosting_services')
  publish(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.hosting.pushZone(principal, domainId);
  }
}
