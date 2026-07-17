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
  MinLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
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
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  id?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

@ValidatorConstraint({ name: 'hasMatchingSkuIdentity', async: false })
class HasMatchingSkuIdentityConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, { object }: ValidationArguments): boolean {
    const value = object as SaveProductSkuDto;
    const hasId = typeof value.id === 'string' && value.id.length > 0;
    const hasVersion = Number.isInteger(value.stockVersion);
    return hasId === hasVersion;
  }

  defaultMessage(): string {
    return 'id 与 stockVersion 必须同时提供或同时省略';
  }
}

class SaveProductSkuDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  id?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  stockVersion?: number;

  @Validate(HasMatchingSkuIdentityConstraint)
  private readonly matchingIdentity?: true;

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
