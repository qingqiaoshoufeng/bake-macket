import type { HomepageDraftConfig } from '@bake-mall/contracts';
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
import { HomepagePage } from './homepage-page.entity.js';

@Entity({ name: 'homepage_drafts' })
@Index('uniq_homepage_drafts_page_name', ['homepagePageId', 'name'], {
  unique: true,
})
@Index('idx_homepage_drafts_page_updated', ['homepagePageId', 'updatedAt', 'id'])
export class HomepageDraft {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'homepage_page_id', type: 'bigint', unsigned: true })
  homepagePageId!: string;

  @ManyToOne(() => HomepagePage, {
    nullable: false,
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'homepage_page_id',
    foreignKeyConstraintName: 'fk_homepage_drafts_page',
  })
  homepagePage!: HomepagePage;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'draft_config', type: 'json' })
  draftConfig!: HomepageDraftConfig;

  @Column({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @Column({
    name: 'updated_by_admin_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  updatedByAdminId!: string | null;

  @ManyToOne(() => AdminUser, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'updated_by_admin_id',
    foreignKeyConstraintName: 'fk_homepage_drafts_updated_admin',
  })
  updatedByAdmin!: AdminUser | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;
}
