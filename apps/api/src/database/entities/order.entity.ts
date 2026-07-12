import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { FulfillmentType, OrderStatus } from '@bake-mall/contracts';

import { User } from './user.entity.js';

/**
 * Order header. Once created, the contact information, fulfilment snapshot
 * and totals are frozen — administrative state transitions do not rewrite
 * these columns. Stock is decremented inside the create-order transaction.
 */
@Entity({ name: 'orders' })
@Index('uniq_orders_order_no', ['orderNo'], { unique: true })
@Index('idx_orders_user', ['userId'])
@Index('idx_orders_status', ['status'])
@Check('chk_orders_total_nonneg', '`goods_total_cents` >= 0')
export class Order {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  orderNo!: string;

  @Column({ type: 'bigint', unsigned: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.NEW })
  status!: OrderStatus;

  @Column({ type: 'enum', enum: FulfillmentType })
  fulfillmentType!: FulfillmentType;

  @Column({ type: 'varchar', length: 64 })
  contactName!: string;

  @Column({ type: 'varchar', length: 32 })
  contactPhone!: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  pickupTimeText!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  deliveryAddressText!: string | null;

  @Column({ type: 'int', unsigned: true })
  goodsTotalCents!: number;

  @Column({ type: 'varchar', length: 512, nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
