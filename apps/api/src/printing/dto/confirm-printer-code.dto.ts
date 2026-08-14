import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

import type { ConfirmCloudPrinterRequest } from '@bake-mall/contracts';

export class ConfirmPrinterCodeDto implements ConfirmCloudPrinterRequest {
  @IsString()
  @MaxLength(64)
  challengeId!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(16)
  @Matches(/^\d+$/u, { message: 'code must be numeric digits' })
  code!: string;

  @IsString()
  @Matches(/^.+$/u, { message: 'operationPassword is required' })
  operationPassword!: string;
}
