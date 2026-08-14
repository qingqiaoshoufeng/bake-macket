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

import { AdminUser } from './admin-user.entity.js';
import { User } from './user.entity.js';

export enum AuditActorType {
  ADMIN = 'ADMIN',
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

/**
 * Back-office audit record. Every privileged mutation (catalog/SKU/Banner
 * edits, order status changes) must append one row describing the actor,
 * target, action and a structured change summary.
 */
@Entity({ name: 'audit_logs' })
@Check(
  'chk_audit_logs_actor',
  "(`actor_type` = 'ADMIN' AND `admin_user_id` IS NOT NULL AND `user_id` IS NULL) OR (`actor_type` = 'USER' AND `admin_user_id` IS NULL AND `user_id` IS NOT NULL) OR (`actor_type` = 'SYSTEM' AND `admin_user_id` IS NULL AND `user_id` IS NULL)",
)
@Index('idx_audit_logs_admin', ['adminUserId'])
@Index('idx_audit_logs_user', ['userId'])
@Index('idx_audit_logs_target', ['targetEntity', 'targetId'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'enum', enum: AuditActorType, name: 'actor_type' })
  actorType!: AuditActorType;

  @Column({
    name: 'admin_user_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  adminUserId!: string | null;

  @ManyToOne(() => AdminUser, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'admin_user_id' })
  adminUser!: AdminUser | null;

  @Column({ name: 'user_id', type: 'bigint', unsigned: true, nullable: true })
  userId!: string | null;

  // RESTRICT preserves the audit chain; user merges retain source rows as tombstones.
  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  @Column({ name: 'target_entity', type: 'varchar', length: 64 })
  targetEntity!: string;

  @Column({ name: 'target_id', type: 'varchar', length: 64 })
  targetId!: string;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'change_summary', type: 'json', nullable: true })
  changeSummary!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;
}
