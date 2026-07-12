import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @MaxLength(64)
  receiverName!: string;

  @Matches(/^1\d{10}$/)
  phone!: string;

  @IsString()
  @MaxLength(64)
  province!: string;

  @IsString()
  @MaxLength(64)
  city!: string;

  @IsString()
  @MaxLength(64)
  district!: string;

  @IsString()
  @Length(1, 256)
  detail!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}

export class SetDefaultAddressDto {
  @IsBoolean()
  isDefault!: true;
}
