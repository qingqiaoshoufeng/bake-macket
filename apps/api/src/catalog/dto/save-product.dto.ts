import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class MediaAssetDto {
  @IsString()
  @MaxLength(512)
  objectKey!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(512)
  publicUrl!: string;
}

class SaveProductImageDto extends MediaAssetDto {
  @IsOptional()
  @IsString()
  id?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

class SaveProductSkuDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MaxLength(80)
  name!: string;

  @IsObject()
  attributes!: Record<string, string>;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock!: number;

  @IsBoolean()
  isActive!: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaAssetDto)
  image!: MediaAssetDto | null;
}

export class SaveProductDto {
  @IsString()
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  summary?: string;

  @IsString()
  categoryId!: string;

  @IsString()
  detailHtml!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaAssetDto)
  coverImage!: MediaAssetDto | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveProductImageDto)
  images!: SaveProductImageDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaveProductSkuDto)
  skus!: SaveProductSkuDto[];

  @IsArray()
  @IsString({ each: true })
  deletedSkuIds!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsBoolean()
  isActive!: boolean;
}
