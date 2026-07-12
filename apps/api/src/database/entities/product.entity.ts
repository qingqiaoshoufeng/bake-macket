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

import { Category } from './category.entity.js';

/**
 * Display-only product. Prices and stock live on {@link Sku}; this entity
 * carries the marketing-facing description, cover media and rich-text detail.
 */
@Entity({ name: 'products' })
@Index('idx_products_category', ['categoryId'])
export class Product {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  summary!: string | null;

  @Column({ name: 'category_id', type: 'bigint', unsigned: true })
  categoryId!: string;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category!: Category;

  @Column({
    name: 'cover_image_url',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  coverImageUrl!: string | null;

  @Column({ name: 'detail_html', type: 'mediumtext' })
  detailHtml!: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
