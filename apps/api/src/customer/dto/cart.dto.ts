import type { UpsertCartItemRequest } from '@bake-mall/contracts';
import { Type } from 'class-transformer';
import { IsInt, IsString, Min, Max } from 'class-validator';

export class UpsertCartItemDto implements UpsertCartItemRequest {
  @IsString()
  skuId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
}
