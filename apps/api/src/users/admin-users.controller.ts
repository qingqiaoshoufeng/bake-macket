import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AdminPermission,
  type AdminUserDetailView,
  type AdminUserPage,
} from '@bake-mall/contracts';

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
  @Header('Cache-Control', 'private, no-store')
  @RequireAdminPermissions(
    AdminPermission.USER_READ,
    AdminPermission.USER_WECHAT_IDENTITY_READ,
  )
  list(@Query() query: AdminUserListQueryDto): Promise<AdminUserPage> {
    return this.adminUsers.list(query);
  }

  @Get(':userId')
  @Header('Cache-Control', 'private, no-store')
  @RequireAdminPermissions(
    AdminPermission.USER_READ,
    AdminPermission.USER_WECHAT_IDENTITY_READ,
  )
  getOne(@Param('userId') userId: string): Promise<AdminUserDetailView> {
    return this.adminUsers.getOne(userId);
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
