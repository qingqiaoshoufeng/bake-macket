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

import { MembershipEntitlementSegmentKind } from '@bake-mall/contracts';

import { MembershipPurchaseOrder } from './membership-purchase-order.entity.js';
import { UserMembership } from './user-membership.entity.js';

@Entity({ name: 'membership_entitlement_segments' })
@Index('uniq_membership_entitlement_segments_purchase', ['purchaseOrderId'], {
  unique: true,
})
@Index('idx_membership_entitlement_segments_membership_period', [
  'membershipId',
  'endsAt',
  'id',
])
@Check('chk_membership_entitlement_segments_period', '`ends_at` > `starts_at`')
@Check(
  'chk_membership_entitlement_segments_upgrade_restore',
  "(`kind` = 'UPGRADE' AND `previous_membership_id` IS NOT NULL AND `previous_membership_ends_at` IS NOT NULL) OR (`kind` IN ('INITIAL','RENEWAL') AND `previous_membership_id` IS NULL AND `previous_membership_ends_at` IS NULL)",
)
export class MembershipEntitlementSegment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'membership_id', type: 'bigint', unsigned: true })
  membershipId!: string;

  @ManyToOne(() => UserMembership, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'membership_id' })
  membership!: UserMembership;

  @Column({ name: 'purchase_order_id', type: 'bigint', unsigned: true })
  purchaseOrderId!: string;

  @ManyToOne(() => MembershipPurchaseOrder, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'purchase_order_id' })
  purchaseOrder!: MembershipPurchaseOrder;

  @Column({ type: 'enum', enum: MembershipEntitlementSegmentKind })
  kind!: MembershipEntitlementSegmentKind;

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

  @ManyToOne(() => UserMembership, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'previous_membership_id' })
  previousMembership!: UserMembership | null;

  @Column({
    name: 'previous_membership_ends_at',
    type: 'datetime',
    precision: 0,
    nullable: true,
  })
  previousMembershipEndsAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;
}
