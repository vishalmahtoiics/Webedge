import { AccountStatus } from '@prisma/client';
import {
  IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCustomerDto {
  @IsString() @MinLength(2) @MaxLength(120)
  fullName!: string;

  @IsEmail({}, { message: 'Enter a valid email address.' }) @MaxLength(254)
  email!: string;

  @IsOptional() @IsString() @MaxLength(160)
  companyName?: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(60)
  billingState?: string;

  // 15 characters: 2 state code, 10 PAN, 1 entity, 1 'Z', 1 checksum.
  @IsOptional()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, {
    message: 'Enter a valid 15-character GSTIN.',
  })
  gstin?: string;

  // Omit to have one generated and shown once.
  @IsOptional() @IsString() @MinLength(10) @MaxLength(512)
  password?: string;
}

export class SetCustomerStatusDto {
  @IsIn(Object.values(AccountStatus))
  status!: AccountStatus;

  // Required by the audit trail: a status change without a stated reason is not
  // reviewable later.
  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

export class AssignPlanDto {
  @IsUUID()
  planId!: string;
}

export class ListCustomersQueryDto {
  @IsOptional() @IsString() @MaxLength(120)
  search?: string;

  @IsOptional() @IsIn(Object.values(AccountStatus))
  status?: AccountStatus;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  take?: number;
}
