import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

import {
  CLOUD_PRINTER_SERIAL_NUMBER_PATTERN,
  CloudPrinterStatus,
  type BindCloudPrinterRequest,
} from '@bake-mall/contracts';

export class BindCloudPrinterDto implements BindCloudPrinterRequest {
  @IsString()
  @Matches(CLOUD_PRINTER_SERIAL_NUMBER_PATTERN, {
    message: 'serialNumber must match [A-Za-z0-9-]{1,64}',
  })
  serialNumber!: string;

  @IsString()
  displayName!: string;

  @IsString()
  @Matches(/^.+$/u, { message: 'operationPassword is required' })
  operationPassword!: string;
}

function transformBooleanQuery({ value }: { readonly value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class CloudPrinterListQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize!: number;

  @IsOptional()
  @Transform(transformBooleanQuery)
  @IsBoolean()
  includeUnbound?: boolean;

  @IsOptional()
  @IsEnum(CloudPrinterStatus)
  status?: CloudPrinterStatus;
}
