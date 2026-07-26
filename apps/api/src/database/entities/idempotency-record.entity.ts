import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from './user.entity.js';

/**
 * Client-supplied idempotency token scoped per user. The same user retrying
 * the same key within the retention window must receive the originally
 * created {@link Order} without additional stock deduction.
 */
@Entity({ name: 'idempotency_records' })
@Index('uniq_idempotency_user_operation_key', ['userId', 'operation', 'key'], {
  unique: true,
})
@Index('idx_idempotency_user', ['userId'])
export class IdempotencyRecord {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 64 })
  operation!: string;

  @Column({ type: 'varchar', length: 128 })
  key!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64, nullable: true })
  requestHash!: string | null;

  @Column({ type: 'enum', enum: ['IN_PROGRESS', 'COMPLETED', 'FAILED'] })
  status!: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

  @Column({
    name: 'resource_type',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'varchar', length: 64, nullable: true })
  resourceId!: string | null;

  @Column({ name: 'response_snapshot', type: 'json', nullable: true })
  responseSnapshot!: Record<string, unknown> | null;

  /** Foreign key into the orders table once the request is finalised. */
  @Column({ name: 'order_id', type: 'bigint', unsigned: true, nullable: true })
  orderId!: string | null;

  @Column({
    name: 'expires_at',
    type: 'datetime',
    precision: 0,
    nullable: true,
  })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
