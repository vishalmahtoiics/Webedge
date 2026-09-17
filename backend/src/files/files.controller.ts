import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Realm } from '@prisma/client';
import { FilesService } from './files.service';
import { CreateFolderDto, PathQueryDto, RenameDto, SetSftpCredentialsDto, WriteFileDto } from './dto/files.dto';
import { CurrentUser, RequirePermissions, RequireRealm } from '../common/decorators/auth.decorators';
import type { Principal } from '../common/principal';

/**
 * Permissions are per operation, not one blanket files.* — a customer role can
 * grant browsing and downloading without granting delete.
 */
@Controller('customer/websites/:websiteId/files')
@RequireRealm(Realm.CUSTOMER)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  @RequirePermissions('files.view')
  list(
    @CurrentUser() principal: Principal,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Query() query: PathQueryDto,
  ) {
    return this.files.list(principal, websiteId, query.path ?? '/');
  }

  @Get('content')
  @RequirePermissions('files.view')
  read(
    @CurrentUser() principal: Principal,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Query() query: PathQueryDto,
  ) {
    return this.files.read(principal, websiteId, query.path ?? '');
  }

  @Put('content')
  @RequirePermissions('files.edit')
  @HttpCode(204)
  async write(
    @CurrentUser() principal: Principal,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() dto: WriteFileDto,
  ): Promise<void> {
    await this.files.write(principal, websiteId, dto.path, dto.content);
  }

  @Post('folders')
  @RequirePermissions('files.create')
  @HttpCode(204)
  async createFolder(
    @CurrentUser() principal: Principal,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() dto: CreateFolderDto,
  ): Promise<void> {
    await this.files.createFolder(principal, websiteId, dto.path, dto.name);
  }

  @Post('rename')
  @RequirePermissions('files.rename')
  @HttpCode(204)
  async rename(
    @CurrentUser() principal: Principal,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() dto: RenameDto,
  ): Promise<void> {
    await this.files.rename(principal, websiteId, dto.path, dto.newName);
  }

  @Delete()
  @RequirePermissions('files.delete')
  @HttpCode(204)
  async remove(
    @CurrentUser() principal: Principal,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Query() query: PathQueryDto,
  ): Promise<void> {
    await this.files.remove(principal, websiteId, query.path ?? '');
  }
}

/** Staff side: configuring the credentials the customer routes above depend on. */
@Controller('admin/websites/:websiteId/sftp')
@RequireRealm(Realm.ADMIN)
export class AdminFilesController {
  constructor(private readonly files: FilesService) {}

  @Put()
  @RequirePermissions('admin.resource_mapping')
  setCredentials(
    @CurrentUser() principal: Principal,
    @Param('websiteId', ParseUUIDPipe) websiteId: string,
    @Body() dto: SetSftpCredentialsDto,
  ) {
    return this.files.setCredentials(principal, websiteId, dto);
  }
}
