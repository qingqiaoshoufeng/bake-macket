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

import { Sku } from './sku.entity.js';
import { User } from './user.entity.js';

/**
 * Active shopping-cart line. Always points at the live SKU; legacy cart rows
 * whose SKU is no longer purchasable are surfaced to the user at checkout and
 * never persist as order history.
 */
@Entity({ name: 'cart_items' })
@Index('uniq_cart_items_user_sku', ['userId', 'skuId'], { unique: true })
@Index('idx_cart_items_user', ['userId'])
@Check('chk_cart_items_qty_positive', '`quantity` > 0')
export class CartItem {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'bigint', unsigned: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'bigint', unsigned: true })
  skuId!: string;

  @ManyToOne(() => Sku, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sku_id' })
  sku!: Sku;

  @Column({ type: 'int', unsigned: true })
  quantity!: number;

  @CreateDateColumn({ type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
