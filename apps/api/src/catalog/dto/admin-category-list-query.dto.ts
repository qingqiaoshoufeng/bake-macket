import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

import {
  BooleanFilter,
  type AdminCategoryListQuery,
} from '@bake-mall/contracts';

import { AdminPageQueryDto } from '../../common/dto/admin-page-query.dto.js';
import { COMPLETE_DATETIME_WITH_TIMEZONE } from '../../common/query/admin-query.helpers.js';

export class AdminCategoryListQueryDto
  extends AdminPageQueryDto
  implements AdminCategoryListQuery
{
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(BooleanFilter)
  isActive?: BooleanFilter;

  @IsOptional()
  @IsEnum(BooleanFilter)
  hasImage?: BooleanFilter;

  @IsOptional()
  @IsEnum(BooleanFilter)
  hasProducts?: BooleanFilter;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  createdAtFrom?: string;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  createdAtBefore?: string;
}
