import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import {
  BooleanFilter,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  type AdminMembershipPurchaseListQuery,
} from '@bake-mall/contracts';

import { AdminPageQueryDto } from '../../common/dto/admin-page-query.dto.js';
import { COMPLETE_DATETIME_WITH_TIMEZONE } from '../../common/query/admin-query.helpers.js';

export class AdminMembershipPurchaseQueryDto
  extends AdminPageQueryDto
  implements AdminMembershipPurchaseListQuery
{
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
  @MaxLength(32)
  userPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  levelId?: string;

  @IsOptional()
  @IsEnum(MembershipPurchaseStatus)
  status?: MembershipPurchaseStatus;

  @IsOptional()
  @IsEnum(MembershipPaymentStatus)
  paymentStatus?: MembershipPaymentStatus;

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
  @IsEnum(BooleanFilter)
  voidable?: BooleanFilter;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  createdAtFrom?: string;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  createdAtBefore?: string;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  paidAtFrom?: string;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  paidAtBefore?: string;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  voidedAtFrom?: string;

  @IsOptional()
  @Matches(COMPLETE_DATETIME_WITH_TIMEZONE)
  @IsISO8601({ strict: true, strictSeparator: true })
  voidedAtBefore?: string;
}
