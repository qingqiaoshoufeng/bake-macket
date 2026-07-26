import { MemberCreditGrantStatus } from '@bake-mall/contracts';
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

import { MemberAccount } from './member-account.entity.js';
import { MembershipPurchaseOrder } from './membership-purchase-order.entity.js';

/** A permanent credit batch issued from one fulfilled membership purchase. */
@Entity({ name: 'member_credit_grants' })
@Index('idx_member_credit_grants_account_created', ['accountId', 'createdAt'])
@Index('uniq_member_credit_grants_purchase', ['purchaseOrderId'], {
  unique: true,
})
@Check(
  'chk_member_credit_grants_remaining_range',
  '`remaining_cents` BETWEEN 0 AND `granted_cents`',
)
export class MemberCreditGrant {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'account_id', type: 'bigint', unsigned: true })
  accountId!: string;

  @ManyToOne(() => MemberAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account!: MemberAccount;

  @Column({ name: 'purchase_order_id', type: 'bigint', unsigned: true })
  purchaseOrderId!: string;

  @ManyToOne(() => MembershipPurchaseOrder, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'purchase_order_id' })
  purchaseOrder!: MembershipPurchaseOrder;

  @Column({ name: 'granted_cents', type: 'int', unsigned: true })
  grantedCents!: number;

  @Column({ name: 'remaining_cents', type: 'int', unsigned: true })
  remainingCents!: number;

  @Column({
    type: 'enum',
    enum: MemberCreditGrantStatus,
    default: MemberCreditGrantStatus.ACTIVE,
  })
  status!: MemberCreditGrantStatus;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
