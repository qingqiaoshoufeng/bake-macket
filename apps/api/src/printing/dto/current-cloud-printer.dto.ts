import type {
  ClearCurrentCloudPrinterRequest,
  SetCurrentCloudPrinterRequest,
} from '@bake-mall/contracts';
import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Min } from 'class-validator';

export class SetCurrentCloudPrinterDto implements SetCurrentCloudPrinterRequest {
  @IsString()
  @Matches(/^[1-9]\d*$/u)
  printerId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsString()
  @Matches(/^.+$/u, { message: 'operationPassword is required' })
  operationPassword!: string;
}

export class ClearCurrentCloudPrinterDto implements ClearCurrentCloudPrinterRequest {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsString()
  @Matches(/^.+$/u, { message: 'operationPassword is required' })
  operationPassword!: string;
}
