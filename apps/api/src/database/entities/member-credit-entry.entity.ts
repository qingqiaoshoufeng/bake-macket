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

import {
  MemberCreditDirection,
  MemberCreditEntryType,
} from '@bake-mall/contracts';

import { MemberAccount } from './member-account.entity.js';

/** Immutable credit ledger entry. Corrections are represented by new entries. */
@Entity({ name: 'member_credit_entries' })
@Index('uniq_member_credit_entries_operation', ['operationKey'], {
  unique: true,
})
@Index('idx_member_credit_entries_account_created', ['accountId', 'createdAt'])
@Check('chk_member_credit_entries_amount_positive', '`amount_cents` > 0')
export class MemberCreditEntry {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'account_id', type: 'bigint', unsigned: true })
  accountId!: string;

  @ManyToOne(() => MemberAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account!: MemberAccount;

  @Column({ type: 'enum', enum: MemberCreditDirection })
  direction!: MemberCreditDirection;

  @Column({ type: 'enum', enum: MemberCreditEntryType })
  type!: MemberCreditEntryType;

  @Column({ name: 'amount_cents', type: 'int', unsigned: true })
  amountCents!: number;

  @Column({ name: 'balance_after_cents', type: 'int', unsigned: true })
  balanceAfterCents!: number;

  @Column({ name: 'reference_type', type: 'varchar', length: 64 })
  referenceType!: string;

  @Column({ name: 'reference_id', type: 'varchar', length: 64 })
  referenceId!: string;

  @Column({ name: 'operation_key', type: 'varchar', length: 128 })
  operationKey!: string;

  @Column({
    name: 'reversal_of_entry_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  reversalOfEntryId!: string | null;

  @ManyToOne(() => MemberCreditEntry, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reversal_of_entry_id' })
  reversalOfEntry!: MemberCreditEntry | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;
}
