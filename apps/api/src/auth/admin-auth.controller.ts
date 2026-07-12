import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { AdminAuthService } from './admin-auth.service.js';
import { AdminLoginDto } from './dto/admin-login.dto.js';

/**
 * Back-office authentication endpoints.
 *
 * - `POST /admin/auth/login` — exchange the bootstrap admin email/password
 *   for an admin JWT. Cross-audience user tokens cannot access admin
 *   endpoints, and this endpoint does not require any guard up front.
 *
 * Mounted under the global `/api/v1` prefix; controllers carry the literal
 * `admin/auth` path so the URL stays explicit.
 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: AdminLoginDto) {
    return this.adminAuth.loginWithCredentials(body.email, body.password);
  }
}
