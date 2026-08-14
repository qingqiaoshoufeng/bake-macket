import { IsString, Matches } from 'class-validator';

import type { RequeryCloudPrinterVendorRelationRequest } from '@bake-mall/contracts';

export class RequeryCloudPrinterVendorRelationDto implements RequeryCloudPrinterVendorRelationRequest {
  @IsString()
  @Matches(/^.+$/u, { message: 'operationPassword is required' })
  operationPassword!: string;
}
