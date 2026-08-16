import 'reflect-metadata';

import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AdminOperationIdempotency } from './admin-operation-idempotency.entity.js';
import { AdminUser } from './admin-user.entity.js';
import { CloudPrinterStoreSetting } from './cloud-printer-store-setting.entity.js';
import { CloudPrinter } from './cloud-printer.entity.js';
import { User } from './user.entity.js';

const buildMetadata = async () => {
  const dataSource = new DataSource({
    type: 'mysql',
    database: 'metadata_test',
    entities: [
      User,
      AdminUser,
      AdminOperationIdempotency,
      CloudPrinter,
      CloudPrinterStoreSetting,
    ],
  });
  await (
    dataSource as DataSource & { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return dataSource.getMetadata(CloudPrinterStoreSetting);
};

describe('CloudPrinterStoreSetting entity metadata', () => {
  it('映射 singleton、无符号 revision 与 UTC DATETIME', async () => {
    const metadata = await buildMetadata();
    const columns = Object.fromEntries(
      metadata.columns.map((column) => [column.propertyName, column]),
    );

    expect(metadata.tableName).toBe('cloud_printer_store_settings');
    expect(columns.id.type).toBe('bigint');
    expect(columns.id.unsigned).toBe(true);
    expect(columns.scopeKey.databaseName).toBe('scope_key');
    expect(columns.scopeKey.length).toBe('32');
    expect(columns.currentPrinterId.type).toBe('bigint');
    expect(columns.currentPrinterId.unsigned).toBe(true);
    expect(columns.currentPrinterId.isNullable).toBe(true);
    expect(columns.revision.type).toBe('int');
    expect(columns.revision.unsigned).toBe(true);
    expect(columns.revision.default).toBe(1);
    expect(columns.updatedByAdminId.unsigned).toBe(true);
    expect(columns.updatedByAdminId.isNullable).toBe(true);
    expect(columns.createdAt.type).toBe('datetime');
    expect(columns.updatedAt.type).toBe('datetime');
  });

  it('对 scope 唯一并配置 current RESTRICT、admin SET NULL', async () => {
    const metadata = await buildMetadata();
    const scopeIndex = metadata.indices.find(
      ({ name }) => name === 'uniq_cloud_printer_store_settings_scope_key',
    );
    const currentRelation = metadata.relations.find(
      ({ propertyName }) => propertyName === 'currentPrinter',
    );
    const adminRelation = metadata.relations.find(
      ({ propertyName }) => propertyName === 'updatedByAdmin',
    );

    expect(scopeIndex?.isUnique).toBe(true);
    expect(scopeIndex?.columns.map(({ propertyName }) => propertyName)).toEqual(
      ['scopeKey'],
    );
    expect(currentRelation?.onDelete).toBe('RESTRICT');
    expect(currentRelation?.onUpdate).toBe('RESTRICT');
    expect(adminRelation?.onDelete).toBe('SET NULL');
    expect(adminRelation?.onUpdate).toBe('RESTRICT');
  });
});
