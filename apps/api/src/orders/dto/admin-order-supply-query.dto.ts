import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  Max,
  Min,
} from 'class-validator';

import {
  SUPPLY_ORDER_STATUSES,
  type AdminOrderSupplyQuery,
  type SupplyOrderStatus,
} from '@bake-mall/contracts';

import { AdminOrderFilterDto } from './admin-order-filter.dto.js';

export const toQueryArray = ({ value }: TransformFnParams): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

export class AdminOrderSupplyQueryDto
  extends AdminOrderFilterDto
  implements AdminOrderSupplyQuery
{
  @Transform(toQueryArray)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn(SUPPLY_ORDER_STATUSES, { each: true })
  supplyStatuses!: SupplyOrderStatus[];

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
