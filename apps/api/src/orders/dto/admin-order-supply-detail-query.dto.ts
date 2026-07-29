import { Type } from 'class-transformer';
import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

import type { AdminOrderSupplyDetailQuery } from '@bake-mall/contracts';

import { AdminOrderSupplyQueryDto } from './admin-order-supply-query.dto.js';

export class AdminOrderSupplyDetailQueryDto
  extends AdminOrderSupplyQueryDto
  implements AdminOrderSupplyDetailQuery
{
  @IsString()
  @MinLength(1)
  groupKey!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  override page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  override pageSize = 50;
}
