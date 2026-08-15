import { AdminRole } from '@bake-mall/contracts';
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

import { User } from './user.entity.js';

/**
 * Merchant back-office account. `loginPhone` is an OPERATOR-only PC login
 * credential and is independent from the linked customer's identity and order
 * contact phones. Legacy OPERATOR rows awaiting reauthorization may remain
 * inactive with a null login phone. The first admin is provisioned via
 * deployment variables or a one-time init script, never a public endpoint.
 */
@Entity({ name: 'admin_users' })
@Check(
  'chk_admin_users_role_identity',
  "(`role` = 'SUPER_ADMIN' AND `username` IS NOT NULL AND `login_phone` IS NULL AND `linked_user_id` IS NULL) OR (`role` = 'OPERATOR' AND `username` IS NULL AND `linked_user_id` IS NOT NULL AND (`login_phone` IS NOT NULL OR `is_active` = 0))",
)
@Index('uniq_admin_users_username', ['username'], { unique: true })
@Index('uniq_admin_users_login_phone', ['loginPhone'], { unique: true })
@Index('uniq_admin_users_linked_user', ['linkedUserId'], { unique: true })
export class AdminUser {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username!: string | null;

  @Column({
    type: 'enum',
    enum: [AdminRole.SUPER_ADMIN, AdminRole.OPERATOR],
  })
  role!: AdminRole;

  @Column({ name: 'login_phone', type: 'varchar', length: 32, nullable: true })
  loginPhone!: string | null;

  @Column({
    name: 'linked_user_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  linkedUserId!: string | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'linked_user_id' })
  linkedUser!: User | null;

  /** Bcrypt or argon2 hash — raw passwords never reach the database. */
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword!: boolean;

  @Column({ name: 'token_version', type: 'int', unsigned: true, default: 1 })
  tokenVersion!: number;

  @Column({
    name: 'verify_failed_count',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  verifyFailedCount!: number;

  @Column({
    name: 'verify_window_started_at',
    type: 'datetime',
    nullable: true,
  })
  verifyWindowStartedAt!: Date | null;

  @Column({
    name: 'last_password_changed_at',
    type: 'datetime',
    nullable: true,
  })
  lastPasswordChangedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
