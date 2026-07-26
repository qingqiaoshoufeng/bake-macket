import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

import type { AdminPageQuery } from '@bake-mall/contracts';

export class AdminPageQueryDto implements AdminPageQuery {
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
