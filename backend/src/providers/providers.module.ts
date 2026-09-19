import { Module } from '@nestjs/common';
import { ProviderAccountsController } from './provider-accounts.controller';
import { ProviderAccountsService } from './provider-accounts.service';
import { CredentialCipherService } from './credential-cipher.service';
import { ProviderRateLimiter } from './rate-limiter.service';
import { ProviderVerificationService } from './provider-verification.service';
import { ActivityService } from '../activity/activity.service';

@Module({
  controllers: [ProviderAccountsController],
  providers: [
    ProviderAccountsService,
    CredentialCipherService,
    ProviderRateLimiter,
    ProviderVerificationService,
    ActivityService,
  ],
  exports: [
    ProviderAccountsService,
    CredentialCipherService,
    ProviderRateLimiter,
    ProviderVerificationService,
  ],
})
export class ProvidersModule {}
