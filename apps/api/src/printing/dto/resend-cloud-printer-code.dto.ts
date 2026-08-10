import { IsString, Matches } from 'class-validator';

import type { ResendCloudPrinterVerificationRequest } from '@bake-mall/contracts';

export class ResendCloudPrinterCodeDto implements ResendCloudPrinterVerificationRequest {
  @IsString()
  @Matches(/^.+$/u, { message: 'operationPassword is required' })
  operationPassword!: string;
}
