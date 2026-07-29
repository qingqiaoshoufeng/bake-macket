import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

import {
  BooleanFilter,
  FulfillmentType,
  type AdminOrderFilterQuery,
} from '@bake-mall/contracts';

import { COMPLETE_DATETIME_WITH_TIMEZONE } from '../../common/query/admin-query.helpers.js';

export class AdminOrderFilterDto implements AdminOrderFilterQuery {
  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  itemQ?: string;

  @IsOptional()
  @IsEnum(BooleanFilter)
  usesMembership?: BooleanFilter;

  @IsOptional()
  @IsEnum(BooleanFilter)
  usesCredit?: BooleanFilter;

  @IsOptional()
  @IsEnum(BooleanFilter)
  hasRemark?: BooleanFilter;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  minPayableCents?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  maxPayableCents?: number;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  createdAtFrom?: string;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  createdAtBefore?: string;
}
