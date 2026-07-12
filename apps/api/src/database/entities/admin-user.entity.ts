import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Merchant back-office account. The first admin is provisioned via deployment
 * environment variables or a one-time init script — never seeded through the
 * public API or migrations.
 */
@Entity({ name: 'admin_users' })
@Index('uniq_admin_users_username', ['username'], { unique: true })
export class AdminUser {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  username!: string;

  /** Bcrypt or argon2 hash — raw passwords never reach the database. */
  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
