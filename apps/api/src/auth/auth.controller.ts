import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from './current-user.decorator.js';
import { BindPhoneDto } from './dto/bind-phone.dto.js';
import { DevLoginDto } from './dto/dev-login.dto.js';
import { DevSendCodeDto } from './dto/dev-send-code.dto.js';
import { JwtUserGuard } from './user-jwt.guard.js';
import { UserAuthService } from './user-auth.service.js';
import type { AuthenticatedUser } from './auth.types.js';

/**
 * Customer-facing authentication endpoints.
 *
 * Mounted under the global `/api/v1` prefix configured in `main.ts`.
 *
 * - `POST /auth/dev/send-code` — mock SMS gateway (non-production only).
 * - `POST /auth/dev/login` — exchange phone + dev code for a user JWT.
 * - `POST /auth/bind-phone` — attach a verified phone to an already-authenticated
 *   customer. Guarded by {@link JwtUserGuard} so only legitimate callers can
 *   bind a phone; cross-audience admin tokens are rejected with `401`.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly userAuth: UserAuthService) {}

  @Post('dev/send-code')
  @HttpCode(HttpStatus.OK)
  async sendCode(@Body() body: DevSendCodeDto): Promise<{ ok: true }> {
    await this.userAuth.sendDevelopmentCode(body.phone);
    return { ok: true };
  }

  @Post('dev/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: DevLoginDto) {
    return this.userAuth.loginWithDevelopmentCode(body.phone, body.code);
  }

  @Post('bind-phone')
  @UseGuards(JwtUserGuard)
  @HttpCode(HttpStatus.OK)
  async bindPhone(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: BindPhoneDto,
  ) {
    return this.userAuth.bindPhone(user, body.phone, body.code);
  }
}
