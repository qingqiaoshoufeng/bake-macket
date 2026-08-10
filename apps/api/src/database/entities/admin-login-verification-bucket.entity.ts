import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'admin_login_verification_buckets' })
export class AdminLoginVerificationBucket {
  @PrimaryColumn({ name: 'bucket_id', type: 'smallint', unsigned: true })
  bucketId!: number;

  @Column({ name: 'failed_count', type: 'int', unsigned: true, default: 0 })
  failedCount!: number;

  @Column({ name: 'window_started_at', type: 'datetime', nullable: true })
  windowStartedAt!: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
