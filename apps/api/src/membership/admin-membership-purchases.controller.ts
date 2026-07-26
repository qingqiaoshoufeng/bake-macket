import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type {
  AdminMembershipPurchaseDetailView,
  AdminMembershipPurchaseListQuery,
  AdminMembershipPurchaseListResult,
} from '@bake-mall/contracts';

import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { CurrentAdmin } from '../auth/current-user.decorator.js';
import { AdminMembershipPurchaseQueryDto } from './dto/admin-membership-purchase-query.dto.js';
import { MembershipPurchaseService } from './membership-purchase.service.js';

@Controller('admin/membership-purchases')
@UseGuards(JwtAdminGuard)
export class AdminMembershipPurchasesController {
  constructor(private readonly purchases: MembershipPurchaseService) {}

  @Get()
  list(
    @Query() query: AdminMembershipPurchaseQueryDto,
  ): Promise<AdminMembershipPurchaseListResult> {
    return this.purchases.listAdminPurchases(
      query as AdminMembershipPurchaseListQuery,
    );
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<AdminMembershipPurchaseDetailView> {
    return this.purchases.getAdminPurchase(id);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  void(
    @Param('id') id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminMembershipPurchaseDetailView> {
    return this.purchases.voidPurchase(id, admin.id);
  }
}
