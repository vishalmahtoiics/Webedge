import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProvidersModule } from './providers/providers.module';
import { CustomersModule } from './customers/customers.module';
import { DnsModule } from './dns/dns.module';
import { DomainsModule } from './domains/domains.module';
import { FilesModule } from './files/files.module';
import { ChecksModule } from './checks/checks.module';
import { BillingModule } from './billing/billing.module';
import { ActivityModule } from './activity/activity.module';
import { PlansModule } from './plans/plans.module';
import { MailModule } from './mail/mail.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { AppExceptionFilter } from './common/filters/app-exception.filter';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ProvidersModule,
    CustomersModule,
    DnsModule,
    DomainsModule,
    FilesModule,
    ChecksModule,
    BillingModule,
    ActivityModule,
    PlansModule,
    MailModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
  ],
  providers: [
    { provide: APP_FILTER, useClass: AppExceptionFilter },
    // Order matters: throttle, then authenticate, then authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
