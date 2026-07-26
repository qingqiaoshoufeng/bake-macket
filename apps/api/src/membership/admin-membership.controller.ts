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
import {
  type AdminMembershipLevelDetailView,
  type AdminMembershipLevelListResult,
} from '@bake-mall/contracts';

import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import { AdminMembershipLevelListQueryDto } from './dto/admin-membership-level-query.dto.js';
import {
  SaveMembershipLevelDto,
  UpdateMembershipLevelStatusDto,
} from './dto/membership-level.dto.js';
import { MembershipService } from './membership.service.js';

@Controller('admin/membership-levels')
@UseGuards(JwtAdminGuard)
export class AdminMembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Get()
  list(
    @Query() query: AdminMembershipLevelListQueryDto,
  ): Promise<AdminMembershipLevelListResult> {
    return this.membership.listAdminLevels(query);
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<AdminMembershipLevelDetailView> {
    return this.membership.getAdminLevel(id);
  }

  @Post()
  create(
    @Body() dto: SaveMembershipLevelDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminMembershipLevelDetailView> {
    return this.membership.createLevel(dto, admin.id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: SaveMembershipLevelDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminMembershipLevelDetailView> {
    return this.membership.updateLevel(id, dto, admin.id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateMembershipLevelStatusDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminMembershipLevelDetailView> {
    return this.membership.updateLevelStatus(
      id,
      dto.status,
      dto.version,
      admin.id,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<void> {
    await this.membership.deleteLevel(id, admin.id);
  }
}
