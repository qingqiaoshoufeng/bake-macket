import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  MembershipLevelStatus,
  MembershipTheme,
  type AdminMembershipLevelListQuery,
  type MembershipBenefit,
  type MembershipCardThemeView,
  type SaveMembershipLevelRequest,
} from '@bake-mall/contracts';

const INT_UNSIGNED_MAX = 4_294_967_295;

class MembershipBenefitDto implements MembershipBenefit {
  @IsString()
  @MaxLength(128)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  iconKey?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INT_UNSIGNED_MAX)
  sortOrder!: number;
}

class MembershipCardThemeDto implements MembershipCardThemeView {
  @IsEnum(MembershipTheme)
  theme!: MembershipTheme;

  @IsString()
  @MaxLength(32)
  badgeText!: string;
}

export class SaveMembershipLevelDto implements SaveMembershipLevelRequest {
  @IsString()
  @Matches(/^[A-Z0-9_]+$/)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  subtitle?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT_UNSIGNED_MAX)
  rank!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INT_UNSIGNED_MAX)
  priceCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INT_UNSIGNED_MAX)
  grantCreditCents!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(10000)
  discountBasisPoints!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  validDays!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MembershipBenefitDto)
  benefits!: MembershipBenefitDto[];

  @IsDefined()
  @ValidateNested()
  @Type(() => MembershipCardThemeDto)
  cardTheme!: MembershipCardThemeDto;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(INT_UNSIGNED_MAX)
  sortOrder!: number;

  @IsEnum(MembershipLevelStatus)
  status!: MembershipLevelStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class AdminMembershipLevelListQueryDto implements AdminMembershipLevelListQuery {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(MembershipLevelStatus)
  status?: MembershipLevelStatus;
}

export class UpdateMembershipLevelStatusDto {
  @IsEnum(MembershipLevelStatus)
  status!: MembershipLevelStatus;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
