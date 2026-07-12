import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { Address } from '../database/entities/address.entity.js';
import { CartItem } from '../database/entities/cart-item.entity.js';
import { IdempotencyRecord } from '../database/entities/idempotency-record.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { OrderItem } from '../database/entities/order-item.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { User } from '../database/entities/user.entity.js';
import { AdminOrdersController } from './admin-orders.controller.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

/**
 * Wires the order lifecycle: customer-facing create/list/get endpoints, the
 * back-office status controller, the transactional {@link OrdersService},
 * and the {@link AuditModule} used to record privileged mutations. The
 * module exports the service for any future feature (e.g. cancellation
 * reminders) that needs to share the same canonical helpers.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Address,
      CartItem,
      Sku,
      Product,
      Order,
      OrderItem,
      IdempotencyRecord,
    ]),
    AuditModule,
  ],
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
