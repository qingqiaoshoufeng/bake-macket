import { type ChangeAdminPasswordRequest } from '@bake-mall/contracts';
import { IsString } from 'class-validator';

export class ChangeAdminPasswordDto implements ChangeAdminPasswordRequest {
  @IsString()
  currentPassword!: string;

  @IsString()
  newPassword!: string;

  @IsString()
  confirmPassword!: string;
}
