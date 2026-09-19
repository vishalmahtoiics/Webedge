import { DomainStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';

export class ListDomainsQueryDto {
  @IsOptional() @IsString() @MaxLength(253)
  search?: string;

  @IsOptional() @IsIn(['all', 'assigned', 'unassigned'])
  owner?: 'all' | 'assigned' | 'unassigned';

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;

  /** Bounded here as well as in the service: every list endpoint has a ceiling. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  take?: number;
}

export class ClaimDomainDto {
  @IsUUID()
  discoveredId!: string;

  @IsUUID()
  customerId!: string;
}

export class CreateDomainDto {
  @IsString() @MaxLength(253)
  name!: string;

  @IsUUID()
  customerId!: string;

  @IsOptional() @IsIn(['ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'PENDING_TRANSFER', 'PENDING_VERIFICATION'])
  status?: DomainStatus;

  @IsOptional() @IsISO8601()
  expiresAt?: string;

  @IsOptional() @IsString() @MaxLength(120)
  registrar?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(253, { each: true })
  nameservers?: string[];

  @IsOptional() @IsBoolean()
  dnsManaged?: boolean;
}
