import { type RevokeOperatorRequest } from '@bake-mall/contracts';
import { IsString } from 'class-validator';

export class RevokeOperatorDto implements RevokeOperatorRequest {
  @IsString()
  currentPassword!: string;
}
