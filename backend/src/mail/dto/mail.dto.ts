import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString,
  MaxLength, Min, MinLength,
} from 'class-validator';

export class AddMailDomainDto {
  @IsString() @MinLength(4) @MaxLength(255)
  name!: string;
}

export class ConfirmNameDto {
  @IsString() @MaxLength(255)
  confirm!: string;
}

export class CreateMailboxDto {
  @IsString() @MinLength(1) @MaxLength(64)
  localPart!: string;

  /**
   * Twelve characters, matching the rule in `mail-password.ts`. Checked in both
   * places on purpose: this one gives a clear message at the edge, and the
   * service one holds even if a caller reaches it another way.
   *
   * A mailbox password faces the open internet on port 993 — every IMAP client
   * in the world may try it, and WebEdge applies no rate limit of its own there.
   */
  @IsString() @MinLength(12) @MaxLength(256)
  password!: string;

  @IsOptional() @IsString() @MaxLength(120)
  displayName?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  quotaMib?: number;
}

export class UpdateMailboxDto {
  @IsOptional() @IsString() @MaxLength(120)
  displayName?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  quotaMib?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class SetMailboxPasswordDto {
  @IsString() @MinLength(12) @MaxLength(256)
  password!: string;
}

export class CreateAliasDto {
  // Up to 64 to allow "*", the catch-all, which is checked in the service
  // because it is the one name that is not a valid address in its own right.
  @IsString() @MinLength(1) @MaxLength(64)
  localPart!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @IsString({ each: true }) @MaxLength(254, { each: true })
  destinations!: string[];
}

export class UpdateAliasDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @IsString({ each: true }) @MaxLength(254, { each: true })
  destinations?: string[];

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class TraceQueryDto {
  @IsString() @MaxLength(254)
  address!: string;
}

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  take?: number;
}
