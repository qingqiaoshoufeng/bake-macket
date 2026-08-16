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

export const CLOUD_PRINTER_STORE_SCOPE = 'STORE';

@Entity({ name: 'cloud_printer_store_settings' })
@Index('uniq_cloud_printer_store_settings_scope_key', ['scopeKey'], {
  unique: true,
})
@Index('idx_cloud_printer_store_settings_current_printer', ['currentPrinterId'])
@Index('idx_cloud_printer_store_settings_updated_by_admin', [
  'updatedByAdminId',
])
export class CloudPrinterStoreSetting {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: string;

  @Column({ name: 'scope_key', type: 'varchar', length: 32 })
  scopeKey!: string;

  @Column({
    name: 'current_printer_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  currentPrinterId!: string | null;

  @ManyToOne(() => CloudPrinter, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'current_printer_id' })
  currentPrinter!: CloudPrinter | null;

  @Column({ type: 'int', unsigned: true, default: 1 })
  revision!: number;

  @Column({
    name: 'updated_by_admin_id',
    type: 'bigint',
    unsigned: true,
    nullable: true,
  })
  updatedByAdminId!: string | null;

  @ManyToOne(() => AdminUser, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({ name: 'updated_by_admin_id' })
  updatedByAdmin!: AdminUser | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 0 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 0 })
  updatedAt!: Date;
}
