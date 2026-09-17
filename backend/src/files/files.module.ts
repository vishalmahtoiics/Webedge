import { Module } from '@nestjs/common';
import { AdminFilesController, FilesController } from './files.controller';
import { FilesService } from './files.service';
import { SftpFileTransport } from './sftp-file-transport';
import { CredentialCipherService } from '../providers/credential-cipher.service';
import { TenantScope } from '../common/tenant-scope';
import { ActivityService } from '../activity/activity.service';

@Module({
  controllers: [FilesController, AdminFilesController],
  providers: [FilesService, SftpFileTransport, CredentialCipherService, TenantScope, ActivityService],
})
export class FilesModule {}
