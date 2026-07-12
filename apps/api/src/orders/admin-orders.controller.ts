import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus } from '@bake-mall/contracts';

import { CurrentAdmin } from '../auth/current-user.decorator.js';
import type { AuthenticatedAdmin } from '../auth/auth.types.js';
import { JwtAdminGuard } from '../auth/admin-jwt.guard.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { OrdersService } from './orders.service.js';

/**
 * Back-office order endpoints. Mounted at `/admin/orders` per the design
 * spec. Status updates are the only mutation exposed here; the controller
 * intentionally does not bind a PUT/PATCH for the order body so admin users
 * cannot rewrite frozen content (contact, address, items).
 */
@Controller('admin/orders')
@UseGuards(JwtAdminGuard)
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query('status') status?: OrderStatus) {
    return this.orders.listAll(status);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.orders.getOne(id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.updateStatus(id, dto.status, admin.id);
  }
}
