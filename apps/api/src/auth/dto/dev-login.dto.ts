import { IsString, Length, Matches } from 'class-validator';

/**
 * Payload for `POST /api/v1/auth/dev/login`. The code is the fixed development
 * verification code (`'123456'`) in non-production environments.
 */
export class DevLoginDto {
  @IsString()
  @Matches(/^\+?\d{6,20}$/, {
    message: 'phone must be 6-20 digits, optionally prefixed with +',
  })
  phone!: string;

  @IsString()
  @Length(6, 6, { message: 'code must be exactly 6 digits' })
  code!: string;
}
