import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AdminAuthService } from './admin-auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { ChangeAdminPasswordDto } from './dto/change-admin-password.dto.js';
import { ChangeInitialOperatorPasswordDto } from './dto/change-initial-operator-password.dto.js';
import { AdminLoginDto } from './dto/admin-login.dto.js';
import { ExchangeOperatorSessionDto } from './dto/exchange-operator-session.dto.js';
import {
  type AuthenticatedAdmin,
  type AuthenticatedUser,
} from './auth.types.js';
import { CurrentAdmin } from './current-user.decorator.js';
import { JwtAdminGuard } from './admin-jwt.guard.js';
import { JwtUserGuard } from './user-jwt.guard.js';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: AdminLoginDto) {
    return this.adminAuth.login(body.toRequest());
  }

  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtUserGuard)
  exchange(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ExchangeOperatorSessionDto,
  ) {
    void body;
    return this.adminAuth.exchangeOperatorSession(user);
  }

  @Post('password/initial')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAdminGuard)
  changeInitialPassword(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() body: ChangeInitialOperatorPasswordDto,
  ) {
    return this.adminAuth.changeInitialOperatorPassword(admin, body);
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAdminGuard)
  changePassword(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() body: ChangeAdminPasswordDto,
  ) {
    return this.adminAuth.changePassword(admin, body);
  }
}
