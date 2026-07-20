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

import {
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipTheme,
  type MembershipBenefit,
} from '@bake-mall/contracts';

import { MembershipLevel } from './membership-level.entity.js';
import { User } from './user.entity.js';

export enum MembershipPaymentChannel {
  SIMULATED = 'SIMULATED',
}

@Entity({ name: 'membership_purchase_orders' })
@Index('uniq_membership_purchase_orders_no', ['purchaseNo'], { unique: true })
@Index('uniq_membership_purchase_orders_user_key', ['userId', 'idempotencyKey'], {
  unique: true,
})
@Index('idx_membership_purchase_orders_user_created', ['userId', 'createdAt'])
@Index('idx_membership_purchase_orders_level', ['membershipLevelId'])
@Check('chk_membership_purchase_level_rank_positive', '`level_rank` > 0')
@Check(
  'chk_membership_purchase_discount_range',
  '`discount_basis_points` BETWEEN 1000 AND 10000',
)
@Check(
  'chk_membership_purchase_valid_days_range',
  '`valid_days` BETWEEN 1 AND 3650',
)
export class MembershipPurchaseOrder {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'purchase_no', type: 'varchar', length: 32 })
  purchaseNo!: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'membership_level_id', type: 'bigint', unsigned: true })
  membershipLevelId!: string;

  @ManyToOne(() => MembershipLevel, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'membership_level_id' })
  membershipLevel!: MembershipLevel;

  @Column({ name: 'level_code', type: 'varchar', length: 64 })
  levelCode!: string;

  @Column({ name: 'level_name', type: 'varchar', length: 128 })
  levelName!: string;

  @Column({ name: 'level_rank', type: 'int', unsigned: true })
  levelRank!: number;

  @Column({ name: 'price_cents', type: 'int', unsigned: true })
  priceCents!: number;

  @Column({ name: 'grant_credit_cents', type: 'int', unsigned: true })
  grantCreditCents!: number;

  @Column({ name: 'discount_basis_points', type: 'int', unsigned: true })
  discountBasisPoints!: number;

  @Column({ name: 'valid_days', type: 'int', unsigned: true })
  validDays!: number;

  @Column({ type: 'json' })
  benefits!: MembershipBenefit[];

  @Column({ type: 'enum', enum: MembershipTheme })
  theme!: MembershipTheme;

  @Column({ name: 'badge_text', type: 'varchar', length: 32 })
  badgeText!: string;

  @Column({
    type: 'enum',
    enum: MembershipPurchaseStatus,
    default: MembershipPurchaseStatus.PENDING,
  })
  status!: MembershipPurchaseStatus;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: MembershipPaymentStatus,
    default: MembershipPaymentStatus.PENDING,
  })
  paymentStatus!: MembershipPaymentStatus;

  @Column({
    name: 'payment_channel',
    type: 'enum',
    enum: MembershipPaymentChannel,
    default: MembershipPaymentChannel.SIMULATED,
  })
  paymentChannel!: MembershipPaymentChannel;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'paid_at', type: 'datetime', precision: 0, nullable: true })
  paidAt!: Date | null;

  @Column({ name: 'voided_at', type: 'datetime', precision: 0, nullable: true })
  voidedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
