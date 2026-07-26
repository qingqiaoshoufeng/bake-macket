import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { FulfillmentType } from '@bake-mall/contracts';

/**
 * Body for `POST /api/v1/orders`. Mirrors `CreateOrderRequest` from
 * `@bake-mall/contracts` with class-validator constraints enforcing the
 * discriminated union at runtime — `cartItemIds` must always be present, while
 * `pickupTimeText` and `addressId` are mutually exclusive depending on the
 * selected `fulfillmentType`.
 */
export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  cartItemIds!: string[];

  @IsEnum(FulfillmentType)
  fulfillmentType!: FulfillmentType;

  @IsString()
  @MaxLength(64)
  contactName!: string;

  @Matches(/^1\d{10}$/)
  contactPhone!: string;

  @ValidateIf(
    (dto: CreateOrderDto) => dto.fulfillmentType === FulfillmentType.PICKUP,
  )
  @IsString()
  @Length(1, 256)
  pickupTimeText?: string;

  @ValidateIf(
    (dto: CreateOrderDto) => dto.fulfillmentType === FulfillmentType.DELIVERY,
  )
  @IsString()
  addressId?: string;

  @IsDefined()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  requestedCreditCents?: number;

  @IsDefined()
  @IsString()
  @Length(1, 4096)
  quoteToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  remark?: string;

  /** Required so we can map incoming values to a known primitive. */
  @Type(() => Object)
  readonly _shape?: never;
}
