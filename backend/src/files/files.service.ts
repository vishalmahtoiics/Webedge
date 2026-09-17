import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { TenantScope } from '../common/tenant-scope';
import { CredentialCipherService } from '../providers/credential-cipher.service';
import { SftpFileTransport, type FileEntry, type SftpCredentials } from './sftp-file-transport';
import { AppError } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * The file manager, for one customer's website.
 *
 * Two gates before any byte moves: the website must belong to the caller's
 * tenant, and the website must have SFTP credentials configured. Credentials are
 * decrypted here and handed to the transport for a single operation — they are
 * never cached, never returned, and never logged.
 *
 * Destructive operations are audited with the path, because "who deleted
 * wp-config.php" is the question support actually gets asked.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: TenantScope,
    private readonly cipher: CredentialCipherService,
    private readonly transport: SftpFileTransport,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Resolves a website the caller owns into usable SFTP credentials.
   *
   * Ownership is checked first, so a website id belonging to another customer is
   * reported as not found before this ever looks at credentials.
   */
  private async credentialsFor(principal: Principal, websiteId: string): Promise<SftpCredentials> {
    await this.scope.findOwned(principal, 'website', websiteId, 'website');

    const record = await this.prisma.websiteSftpCredential.findUnique({ where: { websiteId } });

    if (!record) {
      // Not an error state the customer caused, and not something they can fix,
      // so it reads as unavailable rather than as a failure.
      throw new AppError(
        'CAPABILITY_UNAVAILABLE',
        'File management is not set up for this website yet. Contact support and we will enable it.',
      );
    }

    return {
      host: record.host,
      port: record.port,
      username: record.username,
      password: this.cipher.decrypt(record),
      root: record.root,
    };
  }

  async list(principal: Principal, websiteId: string, path: string): Promise<{ path: string; entries: FileEntry[] }> {
    const creds = await this.credentialsFor(principal, websiteId);
    const entries = await this.transport.list(creds, path);
    return { path: path || '/', entries };
  }

  async read(
    principal: Principal,
    websiteId: string,
    path: string,
  ): Promise<{ path: string; content: string; size: number }> {
    const creds = await this.credentialsFor(principal, websiteId);
    const { content, size } = await this.transport.read(creds, path);
    return { path, content, size };
  }

  async write(principal: Principal, websiteId: string, path: string, content: string): Promise<void> {
    const creds = await this.credentialsFor(principal, websiteId);
    await this.transport.write(creds, path, content);

    await this.activity.record(principal, {
      action: 'files.saved',
      resourceType: 'file',
      resourceId: path,
      visibility: 'CUSTOMER',
      // The path, not the contents: an audit trail that stored file bodies would
      // be an unbounded copy of the customer's website.
      newValue: { path, bytes: Buffer.byteLength(content, 'utf8') },
    });
  }

  async createFolder(principal: Principal, websiteId: string, path: string, name: string): Promise<void> {
    const creds = await this.credentialsFor(principal, websiteId);
    await this.transport.mkdir(creds, path, name);

    await this.activity.record(principal, {
      action: 'files.folder_created',
      resourceType: 'folder',
      resourceId: `${path}/${name}`,
      visibility: 'CUSTOMER',
      newValue: { path, name },
    });
  }

  async rename(principal: Principal, websiteId: string, path: string, newName: string): Promise<void> {
    const creds = await this.credentialsFor(principal, websiteId);
    await this.transport.rename(creds, path, newName);

    await this.activity.record(principal, {
      action: 'files.renamed',
      resourceType: 'file',
      resourceId: path,
      visibility: 'CUSTOMER',
      oldValue: { path },
      newValue: { newName },
    });
  }

  async remove(principal: Principal, websiteId: string, path: string): Promise<void> {
    const creds = await this.credentialsFor(principal, websiteId);
    await this.transport.remove(creds, path);

    await this.activity.record(principal, {
      action: 'files.deleted',
      resourceType: 'file',
      resourceId: path,
      visibility: 'CUSTOMER',
      oldValue: { path },
    });
  }

  /** Staff-only, for the resource-mapping wizard. */
  async setCredentials(
    principal: Principal,
    websiteId: string,
    input: { host: string; port: number; username: string; password: string; root: string },
  ): Promise<{ ok: boolean; message: string }> {
    const website = await this.prisma.website.findUnique({ where: { id: websiteId } });
    if (!website) throw new AppError('RESOURCE_NOT_FOUND', 'That website was not found.');

    // Tested before storing: credentials that do not work are worse than none,
    // because the customer sees a broken file manager rather than an honest
    // unavailable state.
    const test = await this.transport.testConnection({ ...input });
    if (!test.ok) return test;

    const encrypted = this.cipher.encrypt(input.password);

    await this.prisma.websiteSftpCredential.upsert({
      where: { websiteId },
      create: {
        websiteId,
        host: input.host,
        port: input.port,
        username: input.username,
        root: input.root,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        lastVerifiedAt: new Date(),
      },
      update: {
        host: input.host,
        port: input.port,
        username: input.username,
        root: input.root,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        lastVerifiedAt: new Date(),
        lastError: null,
      },
    });

    await this.activity.record(principal, {
      action: 'admin.website.sftp_configured',
      customerId: website.customerId,
      resourceType: 'website',
      resourceId: websiteId,
      // Host and username only. The password never reaches the logger.
      newValue: { host: input.host, port: input.port, username: input.username, root: input.root },
    });

    return { ok: true, message: 'Connected and saved.' };
  }
}
