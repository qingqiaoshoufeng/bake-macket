import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import type { OrderQuoteRequest, OrderQuoteView } from '@bake-mall/contracts';

import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtUserGuard } from '../auth/user-jwt.guard.js';
import { OrderQuoteDto } from './dto/order-quote.dto.js';
import { MembershipPricingService } from './membership-pricing.service.js';

@Controller('orders')
@UseGuards(JwtUserGuard)
export class OrderQuoteController {
  constructor(private readonly pricing: MembershipPricingService) {}

  @Post('quote')
  quote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OrderQuoteDto,
  ): Promise<OrderQuoteView> {
    return this.pricing.quote(user.id, dto as OrderQuoteRequest);
  }
}
