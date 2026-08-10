import { IsString, Matches } from 'class-validator';

import type { ConfirmCloudPrinterCompensationDeletionRequest } from '@bake-mall/contracts';

export class ConfirmCloudPrinterCompensationDeletionDto implements ConfirmCloudPrinterCompensationDeletionRequest {
  @IsString()
  @Matches(/^.+$/u, { message: 'operationPassword is required' })
  operationPassword!: string;
}
