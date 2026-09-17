import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ProviderAccountStatus } from '@prisma/client';

export class CreateProviderAccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  accountName!: string;

  // Drives the capability matrix, so it is constrained to families WebEdge
  // actually models rather than free text.
  @IsOptional()
  @IsIn(['agency-hosting', 'shared'])
  productFamily?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  websiteSlotsTotal?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class AddCredentialDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  label!: string;

  @IsString()
  @MinLength(8, { message: 'That does not look like a valid API token.' })
  @MaxLength(4096)
  token!: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class SetStatusDto {
  @IsIn(Object.values(ProviderAccountStatus))
  status!: ProviderAccountStatus;
}
