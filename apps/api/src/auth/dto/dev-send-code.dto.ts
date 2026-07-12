import { IsString, Matches } from 'class-validator';

/**
 * Payload for `POST /api/v1/auth/dev/send-code`. We accept an E.164-ish phone
 * shape now so the production SMS gateway (later task) does not need a
 * request-shape migration when it replaces the dev mock.
 */
export class DevSendCodeDto {
  @IsString()
  @Matches(/^\+?\d{6,20}$/, {
    message: 'phone must be 6-20 digits, optionally prefixed with +',
  })
  phone!: string;
}
