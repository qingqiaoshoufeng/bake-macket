import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSkuDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock!: number;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSkuDto extends PartialType(CreateSkuDto) {}
