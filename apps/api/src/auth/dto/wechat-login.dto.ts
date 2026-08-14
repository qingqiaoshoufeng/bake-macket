import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import type { WechatLoginRequest } from '@bake-mall/contracts';

export class WechatLoginDto implements WechatLoginRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  code!: string;
}
