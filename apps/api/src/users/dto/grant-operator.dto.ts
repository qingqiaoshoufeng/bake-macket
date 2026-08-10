import { type GrantOperatorRequest } from '@bake-mall/contracts';
import { IsString } from 'class-validator';

export class GrantOperatorDto implements GrantOperatorRequest {
  @IsString()
  currentPassword!: string;

  @IsString()
  temporaryPassword!: string;

  @IsString()
  confirmTemporaryPassword!: string;
}
