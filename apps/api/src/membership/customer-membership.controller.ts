import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Get,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import type {
  MemberCreditEntryView,
  MembershipOverviewView,
  MembershipPurchaseView,
} from '@bake-mall/contracts';

import { requireVerifiedPhone } from '../auth/user-auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtUserGuard } from '../auth/user-jwt.guard.js';
import { CreateMembershipPurchaseDto } from './dto/membership-purchase.dto.js';
import { MembershipPurchaseService } from './membership-purchase.service.js';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

@Controller('me/membership')
@UseGuards(JwtUserGuard)
export class CustomerMembershipController {
  constructor(private readonly purchases: MembershipPurchaseService) {}

  @Get()
  overview(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MembershipOverviewView> {
    return this.purchases.getOverview(user.id);
  }

  @Get('purchases')
  listPurchases(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MembershipPurchaseView[]> {
    return this.purchases.listPurchases(user.id);
  }

  @Get('credit-entries')
  listCreditEntries(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MemberCreditEntryView[]> {
    return this.purchases.listCreditEntries(user.id);
  }

  @Post('purchases')
  @HttpCode(HttpStatus.CREATED)
  createPurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() dto: CreateMembershipPurchaseDto,
  ): Promise<MembershipPurchaseView> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    requireVerifiedPhone(user);
    return this.purchases.createPurchase(user.id, idempotencyKey, dto);
  }

  @Post('purchases/:id/simulate-payment')
  simulatePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
  ): Promise<MembershipPurchaseView> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.purchases.simulatePayment(user.id, id, idempotencyKey);
  }
}
