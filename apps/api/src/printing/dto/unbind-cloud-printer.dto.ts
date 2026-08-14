import type { UnbindCloudPrinterRequest } from '@bake-mall/contracts';
import { IsString, Matches } from 'class-validator';

export class UnbindCloudPrinterDto implements UnbindCloudPrinterRequest {
  @IsString()
  @Matches(/^\d{6,}$/u)
  operationPassword!: string;
}
