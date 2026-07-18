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
  UseGuards,
} from '@nestjs/common';

import type { AdminBannerView, SaveBannerRequest } from '@bake-mall/contracts';

import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import { BannerService } from './banner.service.js';
import { SaveBannerDto } from './dto.js';

@Controller('admin/banners')
@UseGuards(JwtAdminGuard)
export class AdminBannerController {
  constructor(private readonly banners: BannerService) {}

  @Get()
  list(): Promise<AdminBannerView[]> {
    return this.banners.list();
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
