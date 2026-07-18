import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { BannerTargetType } from '@bake-mall/contracts';

class BannerMediaAssetDto {
  @IsString()
  @MaxLength(512)
  objectKey!: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(512)
  publicUrl!: string;
}

export class SaveBannerDto {
  @ValidateNested()
  @Type(() => BannerMediaAssetDto)
  image!: BannerMediaAssetDto;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string;

  @IsEnum(BannerTargetType)
  targetType!: BannerTargetType;

  @ValidateIf((dto: SaveBannerDto) => dto.targetType !== BannerTargetType.NONE)
  @IsString()
  targetId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @IsBoolean()
  isActive!: boolean;
}
