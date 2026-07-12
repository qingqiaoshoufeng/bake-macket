import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class PresignUploadDto {
  @IsIn(['products', 'banners'])
  scope!: 'products' | 'banners';

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes!: number;
}
