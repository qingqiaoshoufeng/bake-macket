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

/**
 * Authenticated customer account.
 *
 * `phone` is the historical identity phone used for normalising identity
 * across WeChat OpenID/UnionID sources. `orderContactPhone` is a separate,
 * non-unique fulfillment contact and never becomes an identity credential.
 */
@Entity({ name: 'users' })
@Index('uniq_users_phone', ['phone'], { unique: true })
@Index('uniq_users_wechat_openid', ['wechatOpenid'], { unique: true })
@Index('uniq_users_wechat_unionid', ['wechatUnionid'], { unique: true })
@Index('idx_users_merged_into', ['mergedIntoUserId'])
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

  @Column({
    name: 'avatar_object_key',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  avatarObjectKey!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ name: 'phone_verified', type: 'boolean', default: false })
  phoneVerified!: boolean;

  @Column({
    name: 'order_contact_phone',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  orderContactPhone!: string | null;

  @Column({
    name: 'order_contact_phone_version',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  orderContactPhoneVersion!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({
    name: 'merged_into_user_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  mergedIntoUserId!: string | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'merged_into_user_id' })
  mergedIntoUser!: User | null;

  @Column({ name: 'token_version', type: 'int', unsigned: true, default: 1 })
  tokenVersion!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
