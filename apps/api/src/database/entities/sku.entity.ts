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
  VersionColumn,
} from 'typeorm';

import { Product } from './product.entity.js';

/**
 * Saleable variant of a {@link Product}. The price (integer cents) and stock
 * always live here; product-level entities carry display data only.
 */
@Entity({ name: 'skus' })
@Index('idx_skus_product', ['productId'])
@Check('chk_skus_price_nonneg', '`price_cents` >= 0')
@Check('chk_skus_stock_nonneg', '`stock` >= 0')
export class Sku {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'product_id', type: 'bigint', unsigned: true })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** Free-form spec map serialised as JSON, e.g. { size: '6寸', taste: '榴莲' }. */
  @Column({ type: 'json' })
  attributes!: Record<string, string>;

  /** Selling price in integer cents. */
  @Column({ name: 'price_cents', type: 'int', unsigned: true })
  priceCents!: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  stock!: number;

  @VersionColumn({
    name: 'stock_version',
    type: 'int',
    unsigned: true,
    default: 1,
  })
  stockVersion!: number;

  @Column({ name: 'image_url', type: 'varchar', length: 512, nullable: true })
  imageUrl!: string | null;

  @Column({
    name: 'image_object_key',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  imageObjectKey!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
