import { IsString, Length, Matches } from 'class-validator';

import type { BindPhoneRequest } from '@bake-mall/contracts';

/**
 * Payload for `POST /api/v1/auth/bind-phone`. Requires the caller to be
 * already authenticated (guarded by {@link JwtUserGuard}); the controller
 * validates the development code before binding the phone.
 */
export class BindPhoneDto implements BindPhoneRequest {
  @IsString()
  @Matches(/^\+?\d{6,20}$/, {
    message: 'phone must be 6-20 digits, optionally prefixed with +',
  })
  phone!: string;

  @IsString()
  @Length(6, 6, { message: 'code must be exactly 6 digits' })
  code!: string;
}
