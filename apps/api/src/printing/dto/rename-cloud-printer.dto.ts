import { IsString } from 'class-validator';

import { type RenameCloudPrinterRequest } from '@bake-mall/contracts';

export class RenameCloudPrinterDto implements RenameCloudPrinterRequest {
  @IsString()
  displayName!: string;
}
