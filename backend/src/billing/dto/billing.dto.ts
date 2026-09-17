import { InvoiceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID,
  Matches, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

export class InvoiceLineDto {
  @IsString() @MinLength(2) @MaxLength(300)
  description!: string;

  /**
   * Paise, as an integer. A rupee amount with a decimal point would arrive as a
   * float and lose paise, which is the one thing `gst.ts` exists to prevent, so
   * the API refuses it at the edge rather than rounding it silently.
   */
  @Type(() => Number) @IsInt({ message: 'Amounts are in whole paise.' })
  unitPriceInPaise!: number;

  @Type(() => Number) @IsInt() @Min(1)
  quantity!: number;

  @IsOptional() @IsString() @Matches(/^[0-9]{6}$/, { message: 'A SAC code is six digits.' })
  sacCode?: string;

  // Basis points, so 18% is 1800 and no rate is ever a float.
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  gstRateBps?: number;
}

export class IssueInvoiceDto {
  @IsUUID()
  customerId!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @ValidateNested({ each: true }) @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  discountInPaise?: number;

  @IsOptional() @Type(() => Date)
  dueAt?: Date;
}

export class ReasonDto {
  // Required, and long enough to be a reason rather than a keystroke: a voided
  // invoice with no stated cause is not reviewable at an audit.
  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

export class ListInvoicesQueryDto {
  @IsOptional() @IsUUID()
  customerId?: string;

  @IsOptional() @IsIn(Object.values(InvoiceStatus))
  status?: InvoiceStatus;

  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}$/, { message: 'Use a financial year like 2026-27.' })
  financialYear?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  take?: number;
}
