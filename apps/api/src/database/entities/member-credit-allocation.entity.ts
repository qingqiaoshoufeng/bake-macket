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

import { MemberCreditEntry } from './member-credit-entry.entity.js';
import { MemberCreditGrant } from './member-credit-grant.entity.js';

/** Links a debit or reversal ledger entry to its specific credit source batch. */
@Entity({ name: 'member_credit_allocations' })
@Index('idx_member_credit_allocations_entry', ['creditEntryId'])
@Index('idx_member_credit_allocations_grant', ['grantId'])
@Check('chk_member_credit_allocations_amount_positive', '`amount_cents` > 0')
export class MemberCreditAllocation {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'credit_entry_id', type: 'bigint', unsigned: true })
  creditEntryId!: string;

  @ManyToOne(() => MemberCreditEntry, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'credit_entry_id' })
  creditEntry!: MemberCreditEntry;

  @Column({ name: 'grant_id', type: 'bigint', unsigned: true })
  grantId!: string;

  @ManyToOne(() => MemberCreditGrant, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'grant_id' })
  grant!: MemberCreditGrant;

  @Column({ name: 'amount_cents', type: 'int', unsigned: true })
  amountCents!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;
}
