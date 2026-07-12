import { Type } from 'class-transformer';
import { IsInt, IsString, Min, Max } from 'class-validator';

export class UpsertCartItemDto {
  @IsString()
  skuId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
}
