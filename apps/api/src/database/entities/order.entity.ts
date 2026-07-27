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

import { UserMembership } from './user-membership.entity.js';
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
@Check(
  'chk_orders_pricing_totals',
  '`payable_total_cents` = `goods_total_cents` - `membership_discount_cents` - `credit_applied_cents`',
)
export class Order {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'order_no', type: 'varchar', length: 32 })
  orderNo!: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.NEW })
  status!: OrderStatus;

  @Column({ name: 'fulfillment_type', type: 'enum', enum: FulfillmentType })
  fulfillmentType!: FulfillmentType;

  @Column({ name: 'contact_name', type: 'varchar', length: 64 })
  contactName!: string;

  @Column({ name: 'contact_phone', type: 'varchar', length: 32 })
  contactPhone!: string;

  @Column({
    name: 'pickup_time_text',
    type: 'varchar',
    length: 256,
    nullable: true,
  })
  pickupTimeText!: string | null;

  @Column({
    name: 'delivery_address_text',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  deliveryAddressText!: string | null;

  @Column({ name: 'goods_total_cents', type: 'int', unsigned: true })
  goodsTotalCents!: number;

  @Column({
    name: 'membership_discount_cents',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  membershipDiscountCents!: number;

  @Column({
    name: 'credit_applied_cents',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  creditAppliedCents!: number;

  @Column({
    name: 'payable_total_cents',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  payableTotalCents!: number;

  @Column({
    name: 'membership_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  membershipId!: string | null;

  @ManyToOne(() => UserMembership, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'membership_id',
    foreignKeyConstraintName: 'fk_orders_membership',
  })
  membership!: UserMembership | null;

  @Column({
    name: 'membership_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  membershipCode!: string | null;

  @Column({
    name: 'membership_name',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  membershipName!: string | null;

  @Column({
    name: 'membership_discount_basis_points',
    type: 'int',
    unsigned: true,
    nullable: true,
  })
  membershipDiscountBasisPoints!: number | null;

  @Column({ name: 'pricing_version', type: 'int', unsigned: true, default: 1 })
  pricingVersion!: number;

  @Column({ type: 'varchar', length: 512, nullable: true })
  remark!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
