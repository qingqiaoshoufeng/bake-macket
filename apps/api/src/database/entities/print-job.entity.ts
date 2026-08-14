import { ManualPrintResolution, PrintJobStatus } from '@bake-mall/contracts';
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

import { AdminUser } from './admin-user.entity.js';
import { CloudPrinter } from './cloud-printer.entity.js';
import { Order } from './order.entity.js';
import { PrintBatch } from './print-batch.entity.js';

@Entity({ name: 'print_jobs' })
@Index('uniq_print_jobs_batch_order', ['batchId', 'orderId'], { unique: true })
@Index('uniq_print_jobs_order_sequence', ['orderId', 'sequence'], {
  unique: true,
})
@Index('idx_print_jobs_queue', ['batchId', 'status', 'sequence'])
@Index('idx_print_jobs_printer', ['printerId'])
@Index('idx_print_jobs_created_by_admin', ['createdByAdminId'])
@Index('idx_print_jobs_manual_resolution_admin', ['manualResolutionByAdminId'])
@Index('idx_print_jobs_supersedes', ['supersedesJobId'])
export class PrintJob {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'batch_id', type: 'bigint', unsigned: true })
  batchId!: string;

  @ManyToOne(() => PrintBatch, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'batch_id' })
  batch!: PrintBatch;

  @Column({ name: 'order_id', type: 'bigint', unsigned: true })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: 'RESTRICT', onUpdate: 'RESTRICT' })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @Column({ name: 'printer_id', type: 'bigint', unsigned: true })
  printerId!: string;

  @ManyToOne(() => CloudPrinter, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'printer_id' })
  printer!: CloudPrinter;

  @Column({ type: 'int', unsigned: true })
  sequence!: number;

  @Column({
    type: 'enum',
    enum: PrintJobStatus,
    default: PrintJobStatus.PENDING,
  })
  status!: PrintJobStatus;

  @Column({ name: 'payload_json', type: 'json', nullable: true })
  payloadJson!: Record<string, unknown> | null;

  @Column({ name: 'payload_hash', type: 'char', length: 64 })
  payloadHash!: string;

  @Column({ name: 'payload_redacted_at', type: 'datetime', nullable: true })
  payloadRedactedAt!: Date | null;

  @Column({
    name: 'vendor_job_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  vendorJobId!: string | null;

  @Column({
    name: 'vendor_error_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  vendorErrorCode!: string | null;

  @Column({ name: 'accepted_at', type: 'datetime', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'unknown_since_at', type: 'datetime', nullable: true })
  unknownSinceAt!: Date | null;

  @Column({
    name: 'unknown_query_count',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  unknownQueryCount!: number;

  @Column({ name: 'last_unknown_query_at', type: 'datetime', nullable: true })
  lastUnknownQueryAt!: Date | null;

  @Column({ name: 'created_by_admin_id', type: 'bigint', unsigned: true })
  createdByAdminId!: string;

  @ManyToOne(() => AdminUser, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'created_by_admin_id' })
  createdByAdmin!: AdminUser;

  @Column({
    name: 'manual_resolution',
    type: 'enum',
    enum: ManualPrintResolution,
    nullable: true,
  })
  manualResolution!: ManualPrintResolution | null;

  @Column({
    name: 'manual_resolution_by_admin_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  manualResolutionByAdminId!: string | null;

  @ManyToOne(() => AdminUser, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'manual_resolution_by_admin_id' })
  manualResolutionByAdmin!: AdminUser | null;

  @Column({ name: 'manual_resolution_at', type: 'datetime', nullable: true })
  manualResolutionAt!: Date | null;

  @Column({
    name: 'supersedes_job_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  supersedesJobId!: string | null;

  @ManyToOne(() => PrintJob, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'supersedes_job_id' })
  supersedesJob!: PrintJob | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
