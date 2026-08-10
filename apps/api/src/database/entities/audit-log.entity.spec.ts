import 'reflect-metadata';

import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AdminUser } from './admin-user.entity.js';
import { AuditLog } from './audit-log.entity.js';
import { User } from './user.entity.js';

describe('AuditLog entity metadata', () => {
  it('maps properties to the existing audit_logs columns', async () => {
    const dataSource = new DataSource({
      type: 'mysql',
      database: 'metadata_test',
      entities: [User, AdminUser, AuditLog],
    });

    await (
      dataSource as DataSource & { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    const metadata = dataSource.getMetadata(AuditLog);
    const databaseNameByProperty = Object.fromEntries(
      metadata.columns.map(({ propertyName, databaseName }) => [
        propertyName,
        databaseName,
      ]),
    );

    expect(databaseNameByProperty).toMatchObject({
      actorType: 'actor_type',
      adminUserId: 'admin_user_id',
      userId: 'user_id',
      targetEntity: 'target_entity',
      targetId: 'target_id',
      action: 'action',
      changeSummary: 'change_summary',
      createdAt: 'created_at',
    });
    const columns = Object.fromEntries(
      metadata.columns.map((column) => [column.propertyName, column]),
    );
    expect(columns.actorType.enum).toEqual(['ADMIN', 'USER', 'SYSTEM']);
    expect(columns.adminUserId.isNullable).toBe(true);
    expect(columns.userId.isNullable).toBe(true);
    const adminForeignKey = metadata.foreignKeys.find(({ columnNames }) =>
      columnNames.includes('admin_user_id'),
    );
    const userForeignKey = metadata.foreignKeys.find(({ columnNames }) =>
      columnNames.includes('user_id'),
    );
    expect(adminForeignKey?.onDelete).toBe('RESTRICT');
    expect(adminForeignKey?.onUpdate).toBe('RESTRICT');
    expect(userForeignKey?.onDelete).toBe('RESTRICT');
    expect(userForeignKey?.onUpdate).toBe('RESTRICT');
    expect(metadata.checks.map(({ name }) => name)).toContain(
      'chk_audit_logs_actor',
    );
    expect(
      metadata.columns.some(({ databaseName }) =>
        [
          'adminUserId',
          'targetEntity',
          'targetId',
          'changeSummary',
          'createdAt',
        ].includes(databaseName),
      ),
    ).toBe(false);
  });
});
