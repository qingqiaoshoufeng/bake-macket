import 'reflect-metadata';

import {
  CloudPrinterOnlineStatus,
  CloudPrinterStatus,
  PrinterBindingStage,
  VendorRelationState,
} from '@bake-mall/contracts';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AdminOperationIdempotency } from './admin-operation-idempotency.entity.js';
import { AdminUser } from './admin-user.entity.js';
import { CloudPrinter } from './cloud-printer.entity.js';
import { User } from './user.entity.js';

const buildMetadata = async () => {
  const dataSource = new DataSource({
    type: 'mysql',
    database: 'metadata_test',
    entities: [User, AdminUser, AdminOperationIdempotency, CloudPrinter],
  });
  await (
    dataSource as DataSource & { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return dataSource.getMetadata(CloudPrinter);
};

describe('CloudPrinter entity metadata', () => {
  it('映射完整云打印机字段、enum 与无符号版本', async () => {
    const metadata = await buildMetadata();
    const columns = Object.fromEntries(
      metadata.columns.map((column) => [column.propertyName, column]),
    );

    expect(metadata.tableName).toBe('cloud_printers');
    expect(columns.serialNumber.databaseName).toBe('serial_number');
    expect(columns.serialNumber.length).toBe('64');
    expect(columns.serialNumber.charset).toBeUndefined();
    expect(columns.serialNumber.collation).toBeUndefined();
    expect(columns.displayName.length).toBe('64');
    expect(columns.status.enum).toEqual(Object.values(CloudPrinterStatus));
    expect(columns.bindingStage.enum).toEqual(
      Object.values(PrinterBindingStage),
    );
    expect(columns.vendorRelationState.enum).toEqual(
      Object.values(VendorRelationState),
    );
    expect(columns.lastOnlineStatus.enum).toEqual(
      Object.values(CloudPrinterOnlineStatus),
    );
    expect(columns.bindingStage.default).toBe(PrinterBindingStage.NONE);
    expect(columns.vendorRelationState.default).toBe(
      VendorRelationState.UNKNOWN,
    );
    expect(columns.lastOnlineStatus.default).toBe(
      CloudPrinterOnlineStatus.UNKNOWN,
    );
    expect(columns.verificationFailedAttempts.unsigned).toBe(true);
    expect(columns.verificationFailedAttempts.default).toBe(0);
    expect(columns.boundByAdminId.type).toBe('bigint');
    expect(columns.boundByAdminId.unsigned).toBe(true);
    expect(columns.bindingOperationId.databaseName).toBe(
      'binding_operation_id',
    );
    expect(columns.bindingOperationId.type).toBe('bigint');
    expect(columns.bindingOperationId.unsigned).toBe(true);
    expect(columns.bindingOperationId.isNullable).toBe(true);
    expect(columns.version.type).toBe('int');
    expect(columns.version.unsigned).toBe(true);
    expect(columns.version.default).toBe(1);
    expect(metadata.versionColumn).toBe(columns.version);
    expect(columns.createdAt.databaseName).toBe('created_at');
    expect(columns.createdAt.type).toBe('datetime');
    expect(columns.updatedAt.databaseName).toBe('updated_at');
    expect(columns.updatedAt.type).toBe('datetime');
  });

  it('对 serial number 建唯一索引并将管理员关联设为 RESTRICT', async () => {
    const metadata = await buildMetadata();
    const serialIndex = metadata.indices.find(
      ({ name }) => name === 'uniq_cloud_printers_serial_number',
    );
    const relation = metadata.relations.find(
      ({ propertyName }) => propertyName === 'boundByAdmin',
    );
    const bindingOperationIndex = metadata.indices.find(
      ({ name }) => name === 'idx_cloud_printers_binding_operation',
    );
    const bindingOperationRelation = metadata.relations.find(
      ({ propertyName }) => propertyName === 'bindingOperation',
    );

    expect(serialIndex?.isUnique).toBe(true);
    expect(
      serialIndex?.columns.map(({ propertyName }) => propertyName),
    ).toEqual(['serialNumber']);
    expect(relation?.onDelete).toBe('RESTRICT');
    expect(relation?.onUpdate).toBe('RESTRICT');
    expect(
      bindingOperationIndex?.columns.map(({ propertyName }) => propertyName),
    ).toEqual(['bindingOperationId']);
    expect(bindingOperationRelation?.onDelete).toBe('RESTRICT');
    expect(bindingOperationRelation?.onUpdate).toBe('RESTRICT');
  });
});
