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
  MembershipStatus,
  MembershipTheme,
  type MembershipBenefit,
} from '@bake-mall/contracts';

import { MembershipLevel } from './membership-level.entity.js';
import { MembershipPurchaseOrder } from './membership-purchase-order.entity.js';
import { User } from './user.entity.js';

@Entity({ name: 'user_memberships' })
@Index('uniq_user_memberships_purchase', ['purchaseOrderId'], { unique: true })
@Index('idx_user_memberships_user_status', ['userId', 'status'])
@Index('idx_user_memberships_level', ['membershipLevelId'])
@Check('chk_user_memberships_level_rank_positive', '`level_rank` > 0')
@Check(
  'chk_user_memberships_discount_range',
  '`discount_basis_points` BETWEEN 1000 AND 10000',
)
@Check('chk_user_memberships_period', '`ends_at` > `starts_at`')
export class UserMembership {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'purchase_order_id', type: 'bigint', unsigned: true })
  purchaseOrderId!: string;

  @ManyToOne(() => MembershipPurchaseOrder, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'purchase_order_id' })
  purchaseOrder!: MembershipPurchaseOrder;

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

  @Column({ name: 'discount_basis_points', type: 'int', unsigned: true })
  discountBasisPoints!: number;

  @Column({ type: 'json' })
  benefits!: MembershipBenefit[];

  @Column({ type: 'enum', enum: MembershipTheme })
  theme!: MembershipTheme;

  @Column({ name: 'badge_text', type: 'varchar', length: 32 })
  badgeText!: string;

  @Column({ name: 'starts_at', type: 'datetime', precision: 0 })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'datetime', precision: 0 })
  endsAt!: Date;

  @Column({
    name: 'previous_membership_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  previousMembershipId!: string | null;

  @ManyToOne(() => UserMembership, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'previous_membership_id' })
  previousMembership!: UserMembership | null;

  @Column({
    type: 'enum',
    enum: MembershipStatus,
    default: MembershipStatus.ACTIVE,
  })
  status!: MembershipStatus;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
