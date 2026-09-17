import { Type } from 'class-transformer';
import { IsDate, IsEmail, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class ActivityQueryDto {
  @IsOptional() @IsUUID()
  customerId?: string;

  @IsOptional() @IsString() @MaxLength(120)
  action?: string;

  @IsOptional() @IsEmail() @MaxLength(254)
  actorEmail?: string;

  @IsOptional() @IsString() @MaxLength(60)
  resourceType?: string;

  @IsOptional() @Type(() => Date) @IsDate()
  from?: Date;

  @IsOptional() @Type(() => Date) @IsDate()
  to?: Date;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  take?: number;
}

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  take?: number;
}
