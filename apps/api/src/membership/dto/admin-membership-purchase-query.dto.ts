import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { MembershipPurchaseStatus } from '@bake-mall/contracts';

export class AdminMembershipPurchaseQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  purchaseNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  levelId?: string;

  @IsOptional()
  @IsEnum(MembershipPurchaseStatus)
  status?: MembershipPurchaseStatus;

  @IsOptional()
  @IsDateString()
  createdAtFrom?: string;

  @IsOptional()
  @IsDateString()
  createdAtBefore?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
