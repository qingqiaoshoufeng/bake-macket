import type { UpdateOrderContactPhoneRequest } from '@bake-mall/contracts';
import { Transform } from 'class-transformer';
import { IsDefined, IsInt, Matches, Min } from 'class-validator';

export class UpdateOrderContactPhoneDto implements UpdateOrderContactPhoneRequest {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^1\d{10}$/)
  phone!: string;

  @IsDefined()
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
