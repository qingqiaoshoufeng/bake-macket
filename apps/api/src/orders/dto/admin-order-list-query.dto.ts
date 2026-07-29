import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { OrderStatus, type AdminOrderListQuery } from '@bake-mall/contracts';

import { AdminOrderFilterDto } from './admin-order-filter.dto.js';

export class AdminOrderListQueryDto
  extends AdminOrderFilterDto
  implements AdminOrderListQuery
{
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

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
