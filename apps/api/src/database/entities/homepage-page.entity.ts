import type {
  HomepageDraftConfig,
  HomepagePublishedConfig,
} from '@bake-mall/contracts';
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
import { HomepageDraft } from './homepage-draft.entity.js';

@Entity({ name: 'homepage_pages' })
@Index('uniq_homepage_pages_page_key', ['pageKey'], { unique: true })
export class HomepagePage {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'page_key', type: 'varchar', length: 32 })
  pageKey!: 'HOME';

  /**
   * Temporary type-level compatibility for the legacy singleton service.
   * Migration 0010 removes this column; task 4 moves editing to HomepageDraft.
   */
  declare draftConfig: HomepageDraftConfig;

  /** @see draftConfig */
  declare version: number;

  /** @see draftConfig */
  declare draftUpdatedByAdminId: string | null;

  /** @see draftConfig */
  declare draftUpdatedAt: Date | null;

  @Column({ name: 'published_config', type: 'json', nullable: true })
  publishedConfig!: HomepagePublishedConfig | null;

  @Column({
    name: 'published_version',
    type: 'int',
    unsigned: true,
    nullable: true,
  })
  publishedVersion!: number | null;

  @Column({
    name: 'published_draft_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  publishedDraftId!: string | null;

  @ManyToOne(() => HomepageDraft, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'published_draft_id',
    foreignKeyConstraintName: 'fk_homepage_pages_published_draft',
  })
  publishedDraft!: HomepageDraft | null;

  @Column({
    name: 'published_draft_version',
    type: 'int',
    unsigned: true,
    nullable: true,
  })
  publishedDraftVersion!: number | null;

  @Column({
    name: 'published_by_admin_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  publishedByAdminId!: string | null;

  @ManyToOne(() => AdminUser, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'published_by_admin_id',
    foreignKeyConstraintName: 'fk_homepage_published_admin',
  })
  publishedByAdmin!: AdminUser | null;

  @Column({
    name: 'published_at',
    type: 'datetime',
    precision: 0,
    nullable: true,
  })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
