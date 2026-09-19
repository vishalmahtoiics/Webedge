import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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
