import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminPermission } from '@bake-mall/contracts';

import { RequireAdminPermissions } from '../auth/admin-permission.decorator.js';
import { AdminPermissionGuard } from '../auth/admin-permission.guard.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import { type AuthenticatedAdmin } from '../auth/auth.types.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminUserListQueryDto } from './dto/admin-user-list-query.dto.js';
import { CreatePlaceholderUserDto } from './dto/create-placeholder-user.dto.js';
import { GrantOperatorDto } from './dto/grant-operator.dto.js';
import { RevokeOperatorDto } from './dto/revoke-operator.dto.js';

@Controller('admin/users')
@UseGuards(JwtAdminGuard, AdminPermissionGuard)
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  @RequireAdminPermissions(AdminPermission.USER_READ)
  list(@Query() query: AdminUserListQueryDto) {
    return this.adminUsers.list(query);
  }

  @Post()
  @RequireAdminPermissions(AdminPermission.USER_CREATE)
  createPlaceholder(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() body: CreatePlaceholderUserDto,
  ) {
    return this.adminUsers.createPlaceholder(admin, body);
  }

  @Post(':userId/operator/grant')
  grant(
    @Param('userId') userId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() body: GrantOperatorDto,
  ) {
    return this.adminUsers.grantOperator(userId, admin, body);
  }

  @Post(':userId/operator/revoke')
  revoke(
    @Param('userId') userId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() body: RevokeOperatorDto,
  ) {
    return this.adminUsers.revokeOperator(userId, admin, body);
  }
}
