import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtUserGuard } from '../auth/user-jwt.guard.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { OrdersService } from './orders.service.js';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * User-facing order endpoints. Mounted at `/api/v1` (no controller-level
 * prefix) so that:
 *
 * - `POST /orders` maps to `POST /api/v1/orders` per the design spec.
 * - `GET /me/orders` and `GET /me/orders/:id` keep the customer-self-only
 *   surface alongside other `/me/*` endpoints.
 */
@Controller()
@UseGuards(JwtUserGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() dto: CreateOrderDto,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException(
        'Idempotency-Key header is required to create an order.',
      );
    }
    return this.orders.create(user.id, idempotencyKey, dto);
  }

  @Get('me/orders')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listMine(user.id);
  }

  @Get('me/orders/:id')
  getMine(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.getMine(user.id, id);
  }
}
