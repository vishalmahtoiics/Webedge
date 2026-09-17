import { DnsRecordType } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Shape and bounds only. The DNS rules that actually matter — apex CNAME,
 * record conflicts, per-type value formats — live in dns-validation.ts, because
 * they are business rules rather than request hygiene.
 */
export class DnsRecordDto {
  @IsIn(Object.values(DnsRecordType))
  type!: DnsRecordType;

  @IsString() @MinLength(1) @MaxLength(253)
  name!: string;

  @IsString() @MinLength(1) @MaxLength(4096)
  value!: string;

  @Type(() => Number) @IsInt() @Min(60) @Max(604800)
  ttl!: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(65535)
  priority?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(65535)
  weight?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(65535)
  port?: number;
}
