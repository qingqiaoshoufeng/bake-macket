import {
  ManualPrintResolution,
  type AppendPrintBatchRequest,
  type CreatePrintBatchRequest,
  type CreateSinglePrintRequest,
  type FailedPrintRetryRequest,
} from '@bake-mall/contracts';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  Matches,
  ValidateIf,
} from 'class-validator';

import { CANONICAL_UNSIGNED_BIGINT } from './printing-dto.constants.js';

export class CreateSinglePrintDto implements CreateSinglePrintRequest {
  @Matches(CANONICAL_UNSIGNED_BIGINT)
  orderId!: string;

  @Matches(CANONICAL_UNSIGNED_BIGINT)
  printerId!: string;
}

export class CreatePrintBatchDto implements CreatePrintBatchRequest {
  @Matches(CANONICAL_UNSIGNED_BIGINT)
  printerId!: string;
}

export class AppendPrintBatchDto implements AppendPrintBatchRequest {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @Matches(CANONICAL_UNSIGNED_BIGINT, { each: true })
  orderIds!: string[];
}

export class EmptyPrintingOperationDto {}

export class FailedPrintRetryDto implements FailedPrintRetryRequest {
  @Matches(CANONICAL_UNSIGNED_BIGINT)
  printerId!: string;
}

export class ManualPrintResolutionDto {
  @IsEnum(ManualPrintResolution)
  resolution!: ManualPrintResolution;

  @ValidateIf(
    (value: ManualPrintResolutionDto) =>
      value.resolution === ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
  )
  @Matches(CANONICAL_UNSIGNED_BIGINT)
  printerId?: string;

  @ValidateIf(
    (value: ManualPrintResolutionDto) =>
      value.resolution === ManualPrintResolution.RETRY_WITH_DUPLICATE_RISK,
  )
  @IsBoolean()
  confirmDuplicateRisk?: true;
}
