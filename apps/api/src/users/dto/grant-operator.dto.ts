import { type GrantOperatorRequest } from '@bake-mall/contracts';
import { IsString, Matches } from 'class-validator';

export class GrantOperatorDto implements GrantOperatorRequest {
  @Matches(/^1\d{10}$/)
  loginPhone!: string;

  @IsString()
  currentPassword!: string;

  @IsString()
  temporaryPassword!: string;

  @IsString()
  confirmTemporaryPassword!: string;
}
