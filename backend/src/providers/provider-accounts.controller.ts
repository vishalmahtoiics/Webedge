import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { ProviderAccountsService } from './provider-accounts.service';
import { ProviderVerificationService } from './provider-verification.service';
import { AddCredentialDto, CreateProviderAccountDto, SetStatusDto } from './dto/provider.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

/**
 * Staff-only. Note the permission split: viewing accounts needs
 * `admin.providers`, but anything touching credentials needs
 * `admin.providers.credentials`, which the operational ADMIN role does not hold.
 *
 * No route returns a decrypted token. The service has no method that would let
 * one, so this is a property of the design rather than of this file.
 */
@Controller('admin/providers')
@RequireRealm(Realm.ADMIN)
export class ProviderAccountsController {
  constructor(
    private readonly accounts: ProviderAccountsService,
    private readonly verification: ProviderVerificationService,
  ) {}

  @Get()
  @RequirePermissions('admin.providers')
  list() {
    return this.accounts.list();
  }

  @Get(':id/capabilities')
  @RequirePermissions('admin.providers')
  capabilities(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.capabilities(id);
  }

  @Post()
  @RequirePermissions('admin.providers')
  create(@CurrentUser() principal: Principal, @Body() dto: CreateProviderAccountDto) {
    return this.accounts.create(principal, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('admin.providers')
  @HttpCode(204)
  async setStatus(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStatusDto,
  ): Promise<void> {
    await this.accounts.setStatus(principal, id, dto.status);
  }

  /**
   * Asks the provider whether the account's current token works.
   *
   * Read-only, so it is safe against a live account — but it spends the
   * account's request budget and reveals which products the token reaches, so
   * it sits behind the credentials permission rather than the viewing one.
   */
  @Post(':id/verify')
  @RequirePermissions('admin.providers.credentials')
  verify(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.verification.verify(principal, id);
  }

  @Post(':id/credentials')
  @RequirePermissions('admin.providers.credentials')
  addCredential(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCredentialDto,
  ) {
    return this.accounts.addCredential(principal, id, dto);
  }

  @Delete('credentials/:credentialId')
  @RequirePermissions('admin.providers.credentials')
  @HttpCode(204)
  async revokeCredential(
    @CurrentUser() principal: Principal,
    @Param('credentialId', ParseUUIDPipe) credentialId: string,
  ): Promise<void> {
    await this.accounts.revokeCredential(principal, credentialId);
  }
}
