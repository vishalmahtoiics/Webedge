import { Module } from '@nestjs/common';
import { ProviderAccountsController } from './provider-accounts.controller';
import { ProviderAccountsService } from './provider-accounts.service';
import { CredentialCipherService } from './credential-cipher.service';
import { ProviderRateLimiter } from './rate-limiter.service';
import { ActivityService } from '../activity/activity.service';

@Module({
  controllers: [ProviderAccountsController],
  providers: [ProviderAccountsService, CredentialCipherService, ProviderRateLimiter, ActivityService],
  exports: [ProviderAccountsService, CredentialCipherService, ProviderRateLimiter],
})
export class ProvidersModule {}
