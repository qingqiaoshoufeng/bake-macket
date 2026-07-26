import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  BooleanFilter,
  MembershipLevelStatus,
  MembershipTheme,
  type AdminMembershipLevelListQuery,
} from '@bake-mall/contracts';

import { AdminPageQueryDto } from '../../common/dto/admin-page-query.dto.js';
import { COMPLETE_DATETIME_WITH_TIMEZONE } from '../../common/query/admin-query.helpers.js';

export class AdminMembershipLevelListQueryDto
  extends AdminPageQueryDto
  implements AdminMembershipLevelListQuery
{
  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;

  @IsOptional()
  @IsEnum(MembershipLevelStatus)
  status?: MembershipLevelStatus;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  rank?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  minPriceCents?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  maxPriceCents?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(10000)
  minDiscountBasisPoints?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(10000)
  maxDiscountBasisPoints?: number;

  @IsOptional()
  @IsEnum(BooleanFilter)
  hasPurchases?: BooleanFilter;

  @IsOptional()
  @IsEnum(MembershipTheme)
  theme?: MembershipTheme;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  minValidDays?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  maxValidDays?: number;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  updatedAtFrom?: string;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  updatedAtBefore?: string;
}
