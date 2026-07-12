import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Authenticated customer account.
 *
 * `phone` is the unique contact handle used for normalising identity across
 * WeChat OpenID/UnionID sources; it must be unique and verified before the
 * customer is allowed to create an order.
 */
@Entity({ name: 'users' })
@Index('uniq_users_phone', ['phone'], { unique: true })
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  wechatOpenid!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  wechatUnionid!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  nickname!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: 'boolean', default: false })
  phoneVerified!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
