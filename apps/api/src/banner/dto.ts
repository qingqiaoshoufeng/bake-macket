import { PartialType } from '@nestjs/mapped-types';
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
} from 'class-validator';

import { BannerTargetType } from '@bake-mall/contracts';

export class CreateBannerDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string;

  @IsEnum(BannerTargetType)
  targetType!: BannerTargetType;

  @ValidateIf(
    (dto: CreateBannerDto) => dto.targetType !== BannerTargetType.NONE,
  )
  @IsString()
  targetId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBannerDto extends PartialType(CreateBannerDto) {}
