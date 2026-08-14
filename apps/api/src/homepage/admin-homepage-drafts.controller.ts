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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import type {
  AdminHomepageDraftListView,
  AdminHomepageView,
  CreateHomepageDraftRequest,
  PublishHomepageRequest,
  RenameHomepageDraftRequest,
  SaveHomepageDraftRequest,
} from '@bake-mall/contracts';

import { AdminPermissionGuard } from '../auth/admin-permission.guard.js';
import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import { UnsignedBigIntStringPipe } from '../common/unsigned-bigint-string.pipe.js';
import { AdminHomepageDraftListQueryDto } from './dto/admin-homepage-draft-list-query.dto.js';
import { CreateHomepageDraftDto } from './dto/create-homepage-draft.dto.js';
import { PublishHomepageDto } from './dto/publish-homepage.dto.js';
import { RenameHomepageDraftDto } from './dto/rename-homepage-draft.dto.js';
import { SaveHomepageDraftDto } from './dto/save-homepage-draft.dto.js';
import { HomepageService } from './homepage.service.js';

@Controller('admin/homepage/drafts')
@UseGuards(JwtAdminGuard, AdminPermissionGuard)
export class AdminHomepageDraftsController {
  constructor(private readonly homepage: HomepageService) {}

  @Get()
  list(
    @Query() query: AdminHomepageDraftListQueryDto,
  ): Promise<AdminHomepageDraftListView> {
    return this.homepage.listDrafts(query);
  }

  @Post()
  create(
    @Body() dto: CreateHomepageDraftDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminHomepageView> {
    return this.homepage.createDraft(
      dto as CreateHomepageDraftRequest,
      admin.id,
    );
  }

  @Get(':id')
  get(
    @Param('id', UnsignedBigIntStringPipe) id: string,
  ): Promise<AdminHomepageView> {
    return this.homepage.getDraft(id);
  }

  @Put(':id')
  save(
    @Param('id', UnsignedBigIntStringPipe) id: string,
    @Body() dto: SaveHomepageDraftDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminHomepageView> {
    return this.homepage.saveDraftById(
      id,
      dto as SaveHomepageDraftRequest,
      admin.id,
    );
  }

  @Patch(':id')
  rename(
    @Param('id', UnsignedBigIntStringPipe) id: string,
    @Body() dto: RenameHomepageDraftDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminHomepageView> {
    return this.homepage.renameDraft(
      id,
      dto as RenameHomepageDraftRequest,
      admin.id,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', UnsignedBigIntStringPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<void> {
    await this.homepage.deleteDraft(id, admin.id);
  }

  @Post(':id/publish')
  publish(
    @Param('id', UnsignedBigIntStringPipe) id: string,
    @Body() dto: PublishHomepageDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminHomepageView> {
    return this.homepage.publishDraftById(
      id,
      dto as PublishHomepageRequest,
      admin.id,
    );
  }
}
