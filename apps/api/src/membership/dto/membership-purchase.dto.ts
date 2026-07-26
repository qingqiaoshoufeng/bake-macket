import { IsString, MaxLength } from 'class-validator';
import type { CreateMembershipPurchaseRequest } from '@bake-mall/contracts';

export class CreateMembershipPurchaseDto implements CreateMembershipPurchaseRequest {
  @IsString()
  @MaxLength(64)
  levelId!: string;
}
