import {
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
} from '@bake-mall/contracts';
import {
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

import { AdminOperationIdempotency } from './admin-operation-idempotency.entity.js';
import { AdminUser } from './admin-user.entity.js';

@Entity({ name: 'cloud_printers' })
@Index('uniq_cloud_printers_serial_number', ['serialNumber'], { unique: true })
@Index('idx_cloud_printers_status', ['status'])
@Index('idx_cloud_printers_bound_by_admin', ['boundByAdminId'])
@Index('idx_cloud_printers_binding_operation', ['bindingOperationId'])
export class CloudPrinter {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'serial_number', type: 'varchar', length: 64 })
  serialNumber!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 64 })
  displayName!: string;

  @Column({ type: 'enum', enum: CloudPrinterStatus })
  status!: CloudPrinterStatus;

  @Column({
    name: 'binding_stage',
    type: 'enum',
    enum: PrinterBindingStage,
    default: PrinterBindingStage.NONE,
  })
  bindingStage!: PrinterBindingStage;

  @Column({
    name: 'vendor_relation_state',
    type: 'enum',
    enum: VendorRelationState,
    default: VendorRelationState.UNKNOWN,
  })
  vendorRelationState!: VendorRelationState;

  @Column({
    name: 'binding_idempotency_key',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  bindingIdempotencyKey!: string | null;

  @Column({
    name: 'binding_operation_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  bindingOperationId?: string | null;

  @ManyToOne(() => AdminOperationIdempotency, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'binding_operation_id' })
  bindingOperation?: AdminOperationIdempotency | null;

  @Column({
    name: 'verification_code_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  verificationCodeHash!: string | null;

  @Column({
    name: 'verification_expires_at',
    type: 'datetime',
    nullable: true,
  })
  verificationExpiresAt!: Date | null;

  @Column({
    name: 'verification_failed_attempts',
    type: 'int',
    unsigned: true,
    default: 0,
  })
  verificationFailedAttempts!: number;

  @Column({ name: 'verified_at', type: 'datetime', nullable: true })
  verifiedAt!: Date | null;

  @Column({
    name: 'last_online_status',
    type: 'enum',
    enum: CloudPrinterOnlineStatus,
    default: CloudPrinterOnlineStatus.UNKNOWN,
  })
  lastOnlineStatus!: CloudPrinterOnlineStatus;

  @Column({
    name: 'last_status_checked_at',
    type: 'datetime',
    nullable: true,
  })
  lastStatusCheckedAt!: Date | null;

  @Column({ name: 'bound_by_admin_id', type: 'bigint', unsigned: true })
  boundByAdminId!: string;

  @ManyToOne(() => AdminUser, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'bound_by_admin_id' })
  boundByAdmin!: AdminUser;

  @Column({
    name: 'last_vendor_error_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  lastVendorErrorCode!: string | null;

  @Column({ name: 'unbound_at', type: 'datetime', nullable: true })
  unboundAt!: Date | null;

  @VersionColumn({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
