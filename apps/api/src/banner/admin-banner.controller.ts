import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type {
  AdminBannerListResult,
  AdminBannerView,
  SaveBannerRequest,
} from '@bake-mall/contracts';

import { AdminPermissionGuard } from '../auth/admin-permission.guard.js';
import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import { BannerService } from './banner.service.js';
import { AdminBannerListQueryDto } from './dto/admin-banner-list-query.dto.js';
import { SaveBannerDto } from './dto.js';

@Controller('admin/banners')
@UseGuards(JwtAdminGuard, AdminPermissionGuard)
export class AdminBannerController {
  constructor(private readonly banners: BannerService) {}

  @Get()
  list(
    @Query() query: AdminBannerListQueryDto,
  ): Promise<AdminBannerListResult> {
    return this.banners.list(query);
  }

  @Post()
  create(
    @Body() dto: SaveBannerDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminBannerView> {
    return this.banners.create(dto as SaveBannerRequest, admin.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: SaveBannerDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminBannerView> {
    return this.banners.update(id, dto as SaveBannerRequest, admin.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.banners.remove(id, admin.id);
  }
}
