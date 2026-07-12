import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Payload for `POST /api/v1/admin/auth/login`. The single administrator is
 * provisioned from environment variables at bootstrap; this endpoint is the
 * only public way to obtain a back-office JWT.
 */
export class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password!: string;
}
