import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsString, Min } from 'class-validator';

export class OrderQuoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  cartItemIds!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  requestedCreditCents!: number;
}
