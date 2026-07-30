import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';

import type {
  AdminHomepageView,
  PublishHomepageRequest,
  SaveHomepageDraftRequest,
} from '@bake-mall/contracts';

import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import { PublishHomepageDto } from './dto/publish-homepage.dto.js';
import { SaveHomepageDraftDto } from './dto/save-homepage-draft.dto.js';
import { HomepageService } from './homepage.service.js';

@Controller('admin/homepage')
@UseGuards(JwtAdminGuard)
export class AdminHomepageController {
  constructor(private readonly homepage: HomepageService) {}

  @Get()
  get(): Promise<AdminHomepageView> {
    return this.homepage.getAdminView();
  }

  @Put('draft')
  saveDraft(
    @Body() dto: SaveHomepageDraftDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminHomepageView> {
    return this.homepage.saveDraft(dto as SaveHomepageDraftRequest, admin.id);
  }

  @Post('publish')
  publish(
    @Body() dto: PublishHomepageDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminHomepageView> {
    return this.homepage.publish(dto as PublishHomepageRequest, admin.id);
  }
}
