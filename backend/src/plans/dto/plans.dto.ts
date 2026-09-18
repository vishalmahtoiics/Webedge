import { BillingCycle } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
  MinLength,
} from 'class-validator';

export class CreatePlanDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'A slug is lowercase words separated by hyphens.',
  })
  @MaxLength(60)
  slug!: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  // Paise, as an integer — a rupee price with a decimal point would arrive as a
  // float and lose paise.
  @Type(() => Number) @IsInt({ message: 'Prices are in whole paise.' }) @Min(0)
  priceInPaise!: number;

  @IsIn(Object.values(BillingCycle))
  billingCycle!: BillingCycle;

  @IsOptional() @IsBoolean()
  isPublic?: boolean;

  // Null means unlimited, which is why these are nullable rather than defaulted
  // to a large number: "unlimited" and "one million" are different promises.
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxWebsites?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxDomains?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxDatabases?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxMailboxes?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  storageGb?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  mailboxQuotaGb?: number;

  /** The upstream product this is fulfilled by. Staff-only, never serialized out. */
  @IsOptional() @IsString() @MaxLength(80)
  providerProduct?: string;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string;

  @IsOptional() @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @MaxLength(60)
  slug?: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  priceInPaise?: number;

  @IsOptional() @IsIn(Object.values(BillingCycle))
  billingCycle?: BillingCycle;

  @IsOptional() @IsBoolean()
  isPublic?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxWebsites?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxDomains?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxDatabases?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxMailboxes?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  storageGb?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  mailboxQuotaGb?: number;

  @IsOptional() @IsString() @MaxLength(80)
  providerProduct?: string;
}

export class SetPlanActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

export class SubscribeDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  planId!: string;
}

export class ChangePlanDto {
  @IsUUID()
  planId!: string;
}

export class CancelSubscriptionDto {
  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

export class ListPlansQueryDto {
  @IsOptional() @IsBoolean() @Type(() => Boolean)
  includeInactive?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  take?: number;
}

export class DueRenewalsQueryDto {
  /**
   * Look ahead to a date, so an operator can see what next week costs before
   * committing to it. Defaults to now, which is what the sweep itself uses.
   */
  @IsOptional() @IsISO8601()
  before?: string;

  /** Bounded here as well as in the service: every list endpoint has a ceiling. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
