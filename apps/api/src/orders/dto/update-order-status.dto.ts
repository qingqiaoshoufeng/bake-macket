import { IsEnum } from 'class-validator';

import { OrderStatus } from '@bake-mall/contracts';

/**
 * Body for `PATCH /api/v1/admin/orders/:id/status`. The state machine guard
 * in {@link OrdersService.updateStatus} is the source of truth for legal
 * transitions; this DTO only validates the value is a recognised
 * {@link OrderStatus} so a typo never reaches the database.
 */
export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}
