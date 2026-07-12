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

import { User } from './user.entity.js';

@Entity({ name: 'addresses' })
@Index('idx_addresses_user', ['userId'])
export class Address {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'bigint', unsigned: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 64 })
  recipient!: string;

  @Column({ type: 'varchar', length: 32 })
  phone!: string;

  @Column({ type: 'varchar', length: 64 })
  province!: string;

  @Column({ type: 'varchar', length: 64 })
  city!: string;

  @Column({ type: 'varchar', length: 64 })
  district!: string;

  @Column({ type: 'varchar', length: 256 })
  detail!: string;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
