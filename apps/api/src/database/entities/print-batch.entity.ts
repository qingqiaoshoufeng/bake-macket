import { PrintBatchStatus } from '@bake-mall/contracts';
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

import { AdminUser } from './admin-user.entity.js';
import { CloudPrinter } from './cloud-printer.entity.js';

@Entity({ name: 'print_batches' })
@Index('idx_print_batches_queue', ['status', 'leaseExpiresAt', 'id'])
@Index('idx_print_batches_lease', ['leaseOwner', 'leaseExpiresAt'])
@Index('idx_print_batches_printer', ['printerId'])
@Index('idx_print_batches_created_by_admin', ['createdByAdminId'])
@Check(
  'chk_print_batches_classified_count',
  '`classified_count` = `accepted_count` + `failed_count` + `manually_resolved_count` + `cancelled_count`',
)
@Check(
  'chk_print_batches_progress_count',
  '`classified_count` + `manual_review_count` <= `total_count`',
)
export class PrintBatch {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'printer_id', type: 'bigint', unsigned: true })
  printerId!: string;

  @ManyToOne(() => CloudPrinter, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'printer_id' })
  printer!: CloudPrinter;

  @Column({ name: 'created_by_admin_id', type: 'bigint', unsigned: true })
  createdByAdminId!: string;

  @ManyToOne(() => AdminUser, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'created_by_admin_id' })
  createdByAdmin!: AdminUser;

  @Column({
    type: 'enum',
    enum: PrintBatchStatus,
    default: PrintBatchStatus.DRAFT,
  })
  status!: PrintBatchStatus;

  @Column({ name: 'lease_owner', type: 'varchar', length: 128, nullable: true })
  leaseOwner!: string | null;

  @Column({ name: 'lease_expires_at', type: 'datetime', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ name: 'total_count', type: 'int', unsigned: true, default: 0 })
  totalCount!: number;

  @Column({
    name: 'classified_count',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  classifiedCount!: number;

  @Column({ name: 'accepted_count', type: 'int', unsigned: true, default: 0 })
  acceptedCount!: number;

  @Column({ name: 'failed_count', type: 'int', unsigned: true, default: 0 })
  failedCount!: number;

  @Column({
    name: 'manual_review_count',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  manualReviewCount!: number;

  @Column({
    name: 'manually_resolved_count',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  manuallyResolvedCount!: number;

  @Column({
    name: 'cancelled_count',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  cancelledCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
