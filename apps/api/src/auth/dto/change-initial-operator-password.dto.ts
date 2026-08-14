import { type ChangeInitialOperatorPasswordRequest } from '@bake-mall/contracts';
import { IsString } from 'class-validator';

export class ChangeInitialOperatorPasswordDto implements ChangeInitialOperatorPasswordRequest {
  @IsString()
  temporaryPassword!: string;

  @IsString()
  newPassword!: string;

  @IsString()
  confirmPassword!: string;
}
