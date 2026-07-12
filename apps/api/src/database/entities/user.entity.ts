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

  @Column({
    name: 'wechat_openid',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  wechatOpenid!: string | null;

  @Column({
    name: 'wechat_unionid',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  wechatUnionid!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  nickname!: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 512, nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ name: 'phone_verified', type: 'boolean', default: false })
  phoneVerified!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
