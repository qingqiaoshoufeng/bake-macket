import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import {
  FulfillmentType,
  OrderStatus,
  type AdminOrderListQuery,
} from '@bake-mall/contracts';

export class AdminOrderListQueryDto implements AdminOrderListQuery {
  @IsOptional()
  @IsString()
  orderNo?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  @IsOptional()
  @IsISO8601({ strict: true })
  createdAtFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
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
