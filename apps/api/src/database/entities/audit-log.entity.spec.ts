import 'reflect-metadata';

import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AdminUser } from './admin-user.entity.js';
import { AuditLog } from './audit-log.entity.js';

describe('AuditLog entity metadata', () => {
  it('maps properties to the existing audit_logs columns', async () => {
    const dataSource = new DataSource({
      type: 'mysql',
      database: 'metadata_test',
      entities: [AdminUser, AuditLog],
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
      adminUserId: 'admin_user_id',
      targetEntity: 'target_entity',
      targetId: 'target_id',
      action: 'action',
      changeSummary: 'change_summary',
      createdAt: 'created_at',
    });
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
