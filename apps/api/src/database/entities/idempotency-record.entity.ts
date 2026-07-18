import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from './user.entity.js';

/**
 * Client-supplied idempotency token scoped per user. The same user retrying
 * the same key within the retention window must receive the originally
 * created {@link Order} without additional stock deduction.
 */
@Entity({ name: 'idempotency_records' })
@Index('uniq_idempotency_user_key', ['userId', 'key'], { unique: true })
@Index('idx_idempotency_user', ['userId'])
export class IdempotencyRecord {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 128 })
  key!: string;

  /** Foreign key into the orders table once the request is finalised. */
  @Column({ name: 'order_id', type: 'bigint', unsigned: true, nullable: true })
  orderId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;
}
