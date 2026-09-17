import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Realm } from '@prisma/client';
import { MailDomainsService } from './mail-domains.service';
import { MailboxesService } from './mailboxes.service';
import { AliasesService } from './aliases.service';
import {
  AddMailDomainDto, ConfirmNameDto, CreateAliasDto, CreateMailboxDto, PageQueryDto,
  SetMailboxPasswordDto, TraceQueryDto, UpdateAliasDto, UpdateMailboxDto,
} from './dto/mail.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import { TenantScope } from '../common/tenant-scope';
import { notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * A customer's mail.
 *
 * Every route is nested under a domain id, and every service method resolves
 * that domain through `TenantScope` before touching anything. `Mailbox` and
 * `MailAlias` carry no `customerId` — their tenant is the domain's — so nesting
 * is what makes the scope unavoidable rather than remembered.
 */
@Controller('customer/mail')
@RequireRealm(Realm.CUSTOMER)
export class MailController {
  constructor(
    private readonly domains: MailDomainsService,
    private readonly mailboxes: MailboxesService,
    private readonly aliases: AliasesService,
  ) {}

  @Get('domains')
  @RequirePermissions('email.view')
  listDomains(@CurrentUser() principal: Principal, @Query() query: PageQueryDto) {
    return this.domains.list(principal, query);
  }

  @Get('domains/:domainId')
  @RequirePermissions('email.view')
  async getDomain(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    const domain = await this.domains.get(principal, domainId);
    return {
      id: domain.id,
      name: domain.name,
      status: domain.status,
      verifiedAt: domain.verifiedAt,
      quotaMib: domain.quotaMib,
      mailboxes: domain._count.mailboxes,
      aliases: domain._count.aliases,
      // The record to publish. Shown while pending and afterwards, because a
      // customer who removes it later needs to know what to put back.
      challenge: this.domains.challenge(domain),
    };
  }

  @Post('domains')
  @RequirePermissions('email.create')
  async addDomain(@CurrentUser() principal: Principal, @Body() dto: AddMailDomainDto) {
    // The tenant comes from the session, never from the body — there is no
    // customerId on this route for a caller to supply.
    const customerId = TenantScope.tenantIdOf(principal);
    if (!customerId) throw notFound();

    const domain = await this.domains.add(principal, customerId, dto.name);
    return { id: domain.id, name: domain.name, status: domain.status, challenge: this.domains.challenge(domain) };
  }

  @Post('domains/:domainId/verify')
  @RequirePermissions('email.create')
  verifyDomain(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.domains.verify(principal, domainId);
  }

  @Delete('domains/:domainId')
  @RequirePermissions('email.delete')
  removeDomain(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Body() dto: ConfirmNameDto,
  ) {
    return this.domains.remove(principal, domainId, dto.confirm);
  }

  @Get('domains/:domainId/mailboxes')
  @RequirePermissions('email.view')
  listMailboxes(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.mailboxes.list(principal, domainId, query);
  }

  @Post('domains/:domainId/mailboxes')
  @RequirePermissions('email.create')
  createMailbox(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Body() dto: CreateMailboxDto,
  ) {
    return this.mailboxes.create(principal, domainId, dto);
  }

  @Patch('domains/:domainId/mailboxes/:mailboxId')
  @RequirePermissions('email.update')
  updateMailbox(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body() dto: UpdateMailboxDto,
  ) {
    return this.mailboxes.update(principal, domainId, mailboxId, dto);
  }

  /** Its own permission: changing a password is not the same as renaming a mailbox. */
  @Post('domains/:domainId/mailboxes/:mailboxId/password')
  @RequirePermissions('email.password_change')
  @HttpCode(204)
  async setMailboxPassword(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body() dto: SetMailboxPasswordDto,
  ): Promise<void> {
    await this.mailboxes.setPassword(principal, domainId, mailboxId, dto.password);
  }

  @Delete('domains/:domainId/mailboxes/:mailboxId')
  @RequirePermissions('email.delete')
  removeMailbox(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Param('mailboxId', ParseUUIDPipe) mailboxId: string,
    @Body() dto: ConfirmNameDto,
  ) {
    return this.mailboxes.remove(principal, domainId, mailboxId, dto.confirm);
  }

  @Get('domains/:domainId/aliases')
  @RequirePermissions('email.view')
  listAliases(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.aliases.list(principal, domainId);
  }

  @Post('domains/:domainId/aliases')
  @RequirePermissions('email.create')
  createAlias(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Body() dto: CreateAliasDto,
  ) {
    return this.aliases.create(principal, domainId, dto);
  }

  @Patch('domains/:domainId/aliases/:aliasId')
  @RequirePermissions('email.update')
  updateAlias(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Param('aliasId', ParseUUIDPipe) aliasId: string,
    @Body() dto: UpdateAliasDto,
  ) {
    return this.aliases.update(principal, domainId, aliasId, dto);
  }

  @Delete('domains/:domainId/aliases/:aliasId')
  @RequirePermissions('email.delete')
  removeAlias(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Param('aliasId', ParseUUIDPipe) aliasId: string,
  ) {
    return this.aliases.remove(principal, domainId, aliasId);
  }

  /**
   * Where an address actually delivers.
   *
   * The question support is asked when a customer says mail is going missing,
   * and answerable here rather than by reading Postfix maps on a server.
   */
  @Get('domains/:domainId/trace')
  @RequirePermissions('email.view')
  trace(
    @CurrentUser() principal: Principal,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @Query() query: TraceQueryDto,
  ) {
    return this.aliases.trace(principal, domainId, query.address);
  }
}
