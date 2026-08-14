import { IsString, Matches } from 'class-validator';

import type { CreatePlaceholderUserRequest } from '@bake-mall/contracts';

export class CreatePlaceholderUserDto implements CreatePlaceholderUserRequest {
  @IsString()
  @Matches(/^\s*1\d{10}\s*$/u, {
    message: 'phone must be an 11-digit mainland number',
  })
  phone!: string;
}
