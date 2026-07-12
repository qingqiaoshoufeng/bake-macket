import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { AdminUser } from './admin-user.entity.js';

/**
 * Back-office audit record. Every privileged mutation (catalog/SKU/Banner
 * edits, order status changes) must append one row describing the actor,
 * target, action and a structured change summary.
 */
@Entity({ name: 'audit_logs' })
@Index('idx_audit_logs_admin', ['adminUserId'])
@Index('idx_audit_logs_target', ['targetEntity', 'targetId'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'bigint', unsigned: true })
  adminUserId!: string;

  @ManyToOne(() => AdminUser, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'admin_user_id' })
  adminUser!: AdminUser;

  @Column({ type: 'varchar', length: 64 })
  targetEntity!: string;

  @Column({ type: 'varchar', length: 64 })
  targetId!: string;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ type: 'json', nullable: true })
  changeSummary!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'datetime', precision: 0 })
  createdAt!: Date;
}
