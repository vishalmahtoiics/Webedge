import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Bounds only. Path safety is decided by path-confinement.ts, because it is a
 * security control rather than request hygiene — and because a DTO rule would be
 * one more place for the two to drift apart.
 */
export class PathQueryDto {
  @IsOptional() @IsString() @MaxLength(4096)
  path?: string;
}

export class WriteFileDto {
  @IsString() @MaxLength(4096)
  path!: string;

  // 2 MB matches the editor's read limit; larger files open read-only.
  @IsString() @MaxLength(2 * 1024 * 1024, { message: 'This file is too large to save from the editor.' })
  content!: string;
}

export class CreateFolderDto {
  @IsString() @MaxLength(4096)
  path!: string;

  @IsString() @MinLength(1) @MaxLength(255)
  name!: string;
}

export class RenameDto {
  @IsString() @MaxLength(4096)
  path!: string;

  @IsString() @MinLength(1) @MaxLength(255)
  newName!: string;
}

export class SetSftpCredentialsDto {
  @IsString() @MinLength(1) @MaxLength(253)
  host!: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(65535)
  port!: number;

  @IsString() @MinLength(1) @MaxLength(64)
  username!: string;

  @IsString() @MinLength(1) @MaxLength(512)
  password!: string;

  @IsString() @MinLength(1) @MaxLength(4096)
  root!: string;
}
