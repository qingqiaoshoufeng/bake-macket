import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { UserMembership } from './user-membership.entity.js';
import { User } from './user.entity.js';

@Entity({ name: 'member_accounts' })
@Index('uniq_member_accounts_user', ['userId'], { unique: true })
export class MemberAccount {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({
    name: 'active_membership_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  activeMembershipId!: string | null;

  @ManyToOne(() => UserMembership, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'active_membership_id' })
  activeMembership!: UserMembership | null;

  @Column({
    name: 'available_credit_cents',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  availableCreditCents!: number;

  @VersionColumn({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
