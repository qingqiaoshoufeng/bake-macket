import 'reflect-metadata';

import { AdminRole } from '@bake-mall/contracts';
import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AdminUser } from './admin-user.entity.js';
import { AdminLoginVerificationBucket } from './admin-login-verification-bucket.entity.js';
import { User } from './user.entity.js';

const buildDataSource = async (): Promise<DataSource> => {
  const dataSource = new DataSource({
    type: 'mysql',
    database: 'metadata_test',
    entities: [User, AdminUser, AdminLoginVerificationBucket],
  });
  await (
    dataSource as DataSource & { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return dataSource;
};

describe('User 与 AdminUser 身份安全实体元数据', () => {
  it('映射用户 tombstone 与 token version，并保留 RESTRICT 自引用', async () => {
    const dataSource = await buildDataSource();
    const metadata = dataSource.getMetadata(User);
    const columns = Object.fromEntries(
      metadata.columns.map((column) => [column.propertyName, column]),
    );

    expect(columns.isActive.databaseName).toBe('is_active');
    expect(columns.isActive.default).toBe(true);
    expect(columns.mergedIntoUserId.databaseName).toBe('merged_into_user_id');
    expect(columns.mergedIntoUserId.type).toBe('bigint');
    expect(columns.mergedIntoUserId.unsigned).toBe(true);
    expect(columns.mergedIntoUserId.isNullable).toBe(true);
    expect(columns.tokenVersion.databaseName).toBe('token_version');
    expect(columns.tokenVersion.type).toBe('int');
    expect(columns.tokenVersion.unsigned).toBe(true);
    expect(columns.tokenVersion.default).toBe(1);

    const foreignKey = metadata.foreignKeys.find(({ columnNames }) =>
      columnNames.includes('merged_into_user_id'),
    );
    expect(foreignKey?.onDelete).toBe('RESTRICT');
    expect(foreignKey?.onUpdate).toBe('CASCADE');
    expect(
      metadata.indices.find(
        ({ givenName }) => givenName === 'idx_users_merged_into',
      ),
    ).toBeDefined();
    expect(
      metadata.indices.find(
        ({ givenName }) => givenName === 'uniq_users_wechat_openid',
      ),
    ).toMatchObject({ isUnique: true });
    expect(
      metadata.indices.find(
        ({ givenName }) => givenName === 'uniq_users_wechat_unionid',
      ),
    ).toMatchObject({ isUnique: true });
  });

  it('只映射固定公开登录 bucket 的窗口聚合字段', async () => {
    const dataSource = await buildDataSource();
    const metadata = dataSource.getMetadata(AdminLoginVerificationBucket);
    const columns = Object.fromEntries(
      metadata.columns.map((column) => [column.propertyName, column]),
    );

    expect(metadata.tableName).toBe('admin_login_verification_buckets');
    expect(Object.keys(columns)).toEqual([
      'bucketId',
      'failedCount',
      'windowStartedAt',
      'updatedAt',
    ]);
    expect(columns.bucketId.databaseName).toBe('bucket_id');
    expect(columns.bucketId.type).toBe('smallint');
    expect(columns.bucketId.unsigned).toBe(true);
    expect(columns.failedCount.type).toBe('int');
    expect(columns.failedCount.unsigned).toBe(true);
    expect(columns.failedCount.default).toBe(0);
    expect(columns.windowStartedAt.type).toBe('datetime');
    expect(columns.windowStartedAt.isNullable).toBe(true);
    expect(columns.updatedAt.databaseName).toBe('updated_at');
    expect(columns.updatedAt.type).toBe('datetime');
    expect(metadata.indices).toEqual([]);
  });

  it('映射管理员角色、唯一 linked user 与共享验证窗口', async () => {
    const dataSource = await buildDataSource();
    const metadata = dataSource.getMetadata(AdminUser);
    const columns = Object.fromEntries(
      metadata.columns.map((column) => [column.propertyName, column]),
    );

    expect(columns.username.isNullable).toBe(true);
    expect(columns.role.enum).toEqual([
      AdminRole.SUPER_ADMIN,
      AdminRole.OPERATOR,
    ]);
    expect(columns.linkedUserId.databaseName).toBe('linked_user_id');
    expect(columns.linkedUserId.type).toBe('bigint');
    expect(columns.linkedUserId.unsigned).toBe(true);
    expect(columns.linkedUserId.isNullable).toBe(true);
    expect(columns.mustChangePassword.databaseName).toBe(
      'must_change_password',
    );
    expect(columns.mustChangePassword.default).toBe(false);
    expect(columns.tokenVersion.type).toBe('int');
    expect(columns.tokenVersion.unsigned).toBe(true);
    expect(columns.tokenVersion.default).toBe(1);
    expect(columns.verifyFailedCount.type).toBe('int');
    expect(columns.verifyFailedCount.unsigned).toBe(true);
    expect(columns.verifyFailedCount.default).toBe(0);
    expect(columns.verifyWindowStartedAt.type).toBe('datetime');
    expect(columns.verifyWindowStartedAt.isNullable).toBe(true);
    expect(columns.lastPasswordChangedAt.type).toBe('datetime');
    expect(columns.lastPasswordChangedAt.isNullable).toBe(true);

    const linkedUserIndexes = metadata.indices.filter(({ columns }) =>
      columns.some(({ databaseName }) => databaseName === 'linked_user_id'),
    );
    expect(
      linkedUserIndexes.map(({ givenName, isUnique }) => ({
        givenName,
        isUnique,
      })),
    ).toEqual([
      {
        givenName: 'uniq_admin_users_linked_user',
        isUnique: true,
      },
    ]);
    expect(metadata.uniques).toEqual([]);
    expect(
      metadata.relations.find(
        ({ propertyName }) => propertyName === 'linkedUser',
      )?.relationType,
    ).toBe('many-to-one');
    expect(metadata.checks.map(({ name }) => name)).toContain(
      'chk_admin_users_role_identity',
    );
    const foreignKey = metadata.foreignKeys.find(({ columnNames }) =>
      columnNames.includes('linked_user_id'),
    );
    expect(foreignKey?.onDelete).toBe('RESTRICT');
    expect(foreignKey?.onUpdate).toBe('RESTRICT');
  });
});
