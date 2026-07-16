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

  @Column({ name: 'image_url', type: 'varchar', length: 512 })
  imageUrl!: string;

  @Column({
    name: 'image_object_key',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  imageObjectKey!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  title!: string | null;

  @Column({
    name: 'target_type',
    type: 'enum',
    enum: BannerTargetType,
    default: BannerTargetType.NONE,
  })
  targetType!: BannerTargetType;

  @Column({ name: 'target_id', type: 'bigint', unsigned: true, nullable: true })
  targetId!: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
