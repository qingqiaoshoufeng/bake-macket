import { IsInt, Min } from 'class-validator';

export class PublishHomepageDto {
  @IsInt()
  @Min(1)
  version!: number;
}
