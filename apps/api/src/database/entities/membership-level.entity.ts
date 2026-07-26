import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { MembershipTheme, type MembershipBenefit } from '@bake-mall/contracts';

@Entity({ name: 'membership_levels' })
@Index('uniq_membership_levels_code', ['code'], { unique: true })
@Index('uniq_membership_levels_rank', ['rank'], { unique: true })
@Index('idx_membership_levels_active_sort', ['isActive', 'sortOrder'])
@Check('chk_membership_levels_rank_positive', '`rank` > 0')
@Check(
  'chk_membership_levels_discount_range',
  '`discount_basis_points` BETWEEN 1000 AND 10000',
)
@Check(
  'chk_membership_levels_valid_days_range',
  '`valid_days` BETWEEN 1 AND 3650',
)
export class MembershipLevel {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  subtitle!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'int', unsigned: true })
  rank!: number;

  @Column({ name: 'price_cents', type: 'int', unsigned: true })
  priceCents!: number;

  @Column({ name: 'grant_credit_cents', type: 'int', unsigned: true })
  grantCreditCents!: number;

  @Column({ name: 'discount_basis_points', type: 'int', unsigned: true })
  discountBasisPoints!: number;

  @Column({ name: 'valid_days', type: 'int', unsigned: true })
  validDays!: number;

  @Column({ type: 'json' })
  benefits!: MembershipBenefit[];

  @Column({ type: 'enum', enum: MembershipTheme })
  theme!: MembershipTheme;

  @Column({ name: 'badge_text', type: 'varchar', length: 32 })
  badgeText!: string;

  @Column({ name: 'sort_order', type: 'int', unsigned: true, default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive!: boolean;

  @VersionColumn({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
