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

import { AdminUser } from './admin-user.entity.js';

export type AdminOperationIdempotencyStatus =
  'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';

@Entity({ name: 'admin_operation_idempotency' })
@Index(
  'uniq_admin_operation_idempotency_scope',
  ['adminId', 'operation', 'key'],
  { unique: true },
)
@Index('idx_admin_operation_idempotency_admin', ['adminId'])
export class AdminOperationIdempotency {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'admin_id', type: 'bigint', unsigned: true })
  adminId!: string;

  @ManyToOne(() => AdminUser, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'admin_id' })
  admin!: AdminUser;

  @Column({ type: 'varchar', length: 64 })
  operation!: string;

  @Column({ type: 'varchar', length: 128 })
  key!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({
    type: 'enum',
    enum: ['IN_PROGRESS', 'COMPLETED', 'FAILED', 'UNKNOWN'],
  })
  status!: AdminOperationIdempotencyStatus;

  @Column({
    name: 'resource_type',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  resourceType!: string | null;

  @Column({
    name: 'resource_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  resourceId!: string | null;

  @Column({ name: 'response_snapshot', type: 'json', nullable: true })
  responseSnapshot!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
