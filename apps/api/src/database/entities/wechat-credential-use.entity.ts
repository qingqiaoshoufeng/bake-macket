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

export enum WechatCredentialKind {
  LOGIN = 'LOGIN',
  PHONE = 'PHONE',
}

export enum WechatCredentialStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity({ name: 'wechat_credential_uses' })
@Index('uniq_wechat_credential_uses_hash', ['credentialHash'], { unique: true })
@Index('idx_wechat_credential_uses_expires', ['expiresAt'])
@Index('idx_wechat_credential_uses_resource_user', ['resourceUserId'])
export class WechatCredentialUse {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ type: 'enum', enum: WechatCredentialKind })
  kind!: WechatCredentialKind;

  /** SHA-256 hex digest only. The original WeChat credential is never persisted. */
  @Column({ name: 'credential_hash', type: 'char', length: 64 })
  credentialHash!: string;

  @Column({ type: 'enum', enum: WechatCredentialStatus })
  status!: WechatCredentialStatus;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt!: Date;

  @Column({
    name: 'resource_user_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  resourceUserId!: string | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'resource_user_id' })
  resourceUser!: User | null;

  @Column({ name: 'response_snapshot', type: 'json', nullable: true })
  responseSnapshot!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
