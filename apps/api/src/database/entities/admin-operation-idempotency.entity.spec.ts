import 'reflect-metadata';

import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AdminOperationIdempotency } from './admin-operation-idempotency.entity.js';
import { AdminUser } from './admin-user.entity.js';
import { User } from './user.entity.js';

const buildMetadata = async () => {
  const dataSource = new DataSource({
    type: 'mysql',
    database: 'metadata_test',
    entities: [User, AdminUser, AdminOperationIdempotency],
  });
  await (
    dataSource as DataSource & { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return dataSource.getMetadata(AdminOperationIdempotency);
};

describe('AdminOperationIdempotency entity metadata', () => {
  it('映射管理员幂等字段、四状态 enum 与 nullable 稳定快照', async () => {
    const metadata = await buildMetadata();
    const columns = Object.fromEntries(
      metadata.columns.map((column) => [column.propertyName, column]),
    );

    expect(metadata.tableName).toBe('admin_operation_idempotency');
    expect(columns.id.type).toBe('bigint');
    expect(columns.id.unsigned).toBe(true);
    expect(columns.adminId.databaseName).toBe('admin_id');
    expect(columns.adminId.type).toBe('bigint');
    expect(columns.adminId.unsigned).toBe(true);
    expect(columns.operation.length).toBe('64');
    expect(columns.key.length).toBe('128');
    expect(columns.ownerTokenHash).toBeUndefined();
    expect(
      metadata.columns.map(({ databaseName }) => databaseName),
    ).not.toContain('owner_token_hash');
    expect(columns.requestHash.databaseName).toBe('request_hash');
    expect(columns.requestHash.type).toBe('char');
    expect(columns.requestHash.length).toBe('64');
    expect(columns.status.enum).toEqual([
      'IN_PROGRESS',
      'COMPLETED',
      'FAILED',
      'UNKNOWN',
    ]);
    expect(columns.resourceType.length).toBe('64');
    expect(columns.resourceType.isNullable).toBe(true);
    expect(columns.resourceId.length).toBe('64');
    expect(columns.resourceId.isNullable).toBe(true);
    expect(columns.responseSnapshot.type).toBe('json');
    expect(columns.responseSnapshot.isNullable).toBe(true);
    expect(columns.createdAt.databaseName).toBe('created_at');
    expect(columns.createdAt.type).toBe('datetime');
    expect(columns.updatedAt.databaseName).toBe('updated_at');
    expect(columns.updatedAt.type).toBe('datetime');
  });

  it('以 admin、operation、key 建唯一 scope 且管理员 FK 为 RESTRICT', async () => {
    const metadata = await buildMetadata();
    const scope = metadata.indices.find(
      ({ name }) => name === 'uniq_admin_operation_idempotency_scope',
    );
    const relation = metadata.relations.find(
      ({ propertyName }) => propertyName === 'admin',
    );

    expect(scope?.isUnique).toBe(true);
    expect(scope?.columns.map(({ propertyName }) => propertyName)).toEqual([
      'adminId',
      'operation',
      'key',
    ]);
    expect(relation?.onDelete).toBe('RESTRICT');
    expect(relation?.onUpdate).toBe('RESTRICT');
  });
});
