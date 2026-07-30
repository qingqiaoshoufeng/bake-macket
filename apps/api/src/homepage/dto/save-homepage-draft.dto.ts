import { IsInt, IsObject, Min } from 'class-validator';

import type { HomepageDraftConfig } from '@bake-mall/contracts';

export class SaveHomepageDraftDto {
  @IsObject()
  config!: HomepageDraftConfig;

  @IsInt()
  @Min(1)
  version!: number;
}
