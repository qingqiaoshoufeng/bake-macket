import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

import {
  BannerTargetType,
  BooleanFilter,
  type AdminBannerListQuery,
} from '@bake-mall/contracts';

import { AdminPageQueryDto } from '../../common/dto/admin-page-query.dto.js';
import { COMPLETE_DATETIME_WITH_TIMEZONE } from '../../common/query/admin-query.helpers.js';

export class AdminBannerListQueryDto
  extends AdminPageQueryDto
  implements AdminBannerListQuery
{
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(BooleanFilter)
  isActive?: BooleanFilter;

  @IsOptional()
  @IsEnum(BannerTargetType)
  targetType?: BannerTargetType;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsEnum(BooleanFilter)
  targetValid?: BooleanFilter;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  createdAtFrom?: string;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  createdAtBefore?: string;
}
