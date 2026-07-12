import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { BannerTargetType } from '@bake-mall/contracts';

/**
 * Home-page banner. Only entries with {@link isActive} true and a resolvable
 * target are surfaced to the customer H5.
 */
@Entity({ name: 'banners' })
@Index('idx_banners_active_sort', ['isActive', 'sortOrder'])
export class Banner {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'varchar', length: 512 })
  imageUrl!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  title!: string | null;

  @Column({
    type: 'enum',
    enum: BannerTargetType,
    default: BannerTargetType.NONE,
  })
  targetType!: BannerTargetType;

  @Column({ type: 'bigint', unsigned: true, nullable: true })
  targetId!: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
