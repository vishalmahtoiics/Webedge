import { Module } from '@nestjs/common';
import { AdminDomainsController } from './admin-domains.controller';
import { AdminDomainsService } from './admin-domains.service';

@Module({
  controllers: [AdminDomainsController],
  providers: [AdminDomainsService],
  exports: [AdminDomainsService],
})
export class DomainsModule {}
