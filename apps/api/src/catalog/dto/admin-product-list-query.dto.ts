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
  ProductStockFilter,
  type AdminProductListQuery,
} from '@bake-mall/contracts';

import { AdminPageQueryDto } from '../../common/dto/admin-page-query.dto.js';
import { COMPLETE_DATETIME_WITH_TIMEZONE } from '../../common/query/admin-query.helpers.js';

export class AdminProductListQueryDto
  extends AdminPageQueryDto
  implements AdminProductListQuery
{
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsEnum(BooleanFilter)
  isActive?: BooleanFilter;

  @IsOptional()
  @IsEnum(BooleanFilter)
  hasActiveSku?: BooleanFilter;

  @IsOptional()
  @IsEnum(ProductStockFilter)
  stock?: ProductStockFilter;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @IsOptional()
  @IsEnum(BooleanFilter)
  hasCoverImage?: BooleanFilter;

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

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  createdAtFrom?: string;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  createdAtBefore?: string;
}
