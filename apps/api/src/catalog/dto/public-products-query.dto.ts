import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PublicProductsQueryDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  q?: string;
}
