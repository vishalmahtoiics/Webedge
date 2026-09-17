import { Module } from '@nestjs/common';
import { SslController } from './ssl.controller';
import { TlsInspector } from './tls-inspector';
import { TenantScope } from '../common/tenant-scope';

@Module({
  controllers: [SslController],
  providers: [
    // No connector argument, so the guarded default is used in production.
    { provide: TlsInspector, useFactory: () => new TlsInspector() },
    TenantScope,
  ],
  exports: [TlsInspector],
})
export class ChecksModule {}
