import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import type { WechatPhoneRequest } from '@bake-mall/contracts';

export class WechatPhoneDto implements WechatPhoneRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  code!: string;
}
