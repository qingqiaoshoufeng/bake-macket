import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Order } from './order.entity.js';

/**
 * Immutable snapshot of one SKU at the moment the order was created. Order
 * details must render from these columns even after the underlying product
 * or SKU changes.
 */
@Entity({ name: 'order_items' })
@Index('idx_order_items_order', ['orderId'])
@Check('chk_order_items_unit_price_nonneg', '`unit_price_cents` >= 0')
@Check('chk_order_items_qty_positive', '`quantity` > 0')
export class OrderItem {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'order_id', type: 'bigint', unsigned: true })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @Column({ name: 'product_name', type: 'varchar', length: 128 })
  productName!: string;

  @Column({ name: 'sku_name', type: 'varchar', length: 128 })
  skuName!: string;

  /** Spec attributes snapshotted from the SKU at order creation. */
  @Column({ name: 'sku_attributes', type: 'json' })
  skuAttributes!: Record<string, string>;

  @Column({ name: 'image_url', type: 'varchar', length: 512, nullable: true })
  imageUrl!: string | null;

  @Column({ name: 'unit_price_cents', type: 'int', unsigned: true })
  unitPriceCents!: number;

  @Column({ type: 'int', unsigned: true })
  quantity!: number;

  @Column({
    name: 'line_goods_total_cents',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  lineGoodsTotalCents!: number;

  @Column({
    name: 'line_membership_discount_cents',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  lineMembershipDiscountCents!: number;

  @Column({
    name: 'line_payable_cents',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  linePayableCents!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;
}
