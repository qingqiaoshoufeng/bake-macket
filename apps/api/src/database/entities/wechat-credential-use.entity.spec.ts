import 'reflect-metadata';

import { DataSource } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { User } from './user.entity.js';
import {
  WechatCredentialKind,
  WechatCredentialStatus,
  WechatCredentialUse,
} from './wechat-credential-use.entity.js';

const metadataSource = async (): Promise<DataSource> => {
  const dataSource = new DataSource({
    type: 'mysql',
    database: 'metadata_test',
    entities: [User, WechatCredentialUse],
  });
  await (
    dataSource as DataSource & { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return dataSource;
};

describe('WechatCredentialUse 实体元数据', () => {
  it('只映射 SHA-256 hash，不暴露任何明文 credential 或 code 字段', async () => {
    const dataSource = await metadataSource();
    const metadata = dataSource.getMetadata(WechatCredentialUse);
    const databaseNames = metadata.columns.map(
      ({ databaseName }) => databaseName,
    );

    expect(databaseNames.toSorted()).toEqual(
      [
        'id',
        'kind',
        'credential_hash',
        'status',
        'expires_at',
        'resource_user_id',
        'response_snapshot',
        'created_at',
        'updated_at',
      ].toSorted(),
    );
    expect(databaseNames).not.toContain('credential');
    expect(databaseNames).not.toContain('code');
    expect(databaseNames).not.toContain('login_code');
    expect(databaseNames).not.toContain('phone_code');

    const hash = metadata.columns.find(
      ({ propertyName }) => propertyName === 'credentialHash',
    );
    expect(hash?.type).toBe('char');
    expect(hash?.length).toBe('64');
    expect(
      metadata.indices.find(
        ({ givenName }) => givenName === 'uniq_wechat_credential_uses_hash',
      )?.isUnique,
    ).toBe(true);
  });

  it('提供 claim/reclaim 所需 kind、status、expires 与资源用户字段', async () => {
    const dataSource = await metadataSource();
    const metadata = dataSource.getMetadata(WechatCredentialUse);
    const columns = Object.fromEntries(
      metadata.columns.map((column) => [column.propertyName, column]),
    );

    expect(columns.kind.enum).toEqual([
      WechatCredentialKind.LOGIN,
      WechatCredentialKind.PHONE,
    ]);
    expect(Object.values(WechatCredentialKind)).toEqual(['LOGIN', 'PHONE']);
    expect(columns.status.enum).toEqual([
      WechatCredentialStatus.IN_PROGRESS,
      WechatCredentialStatus.COMPLETED,
      WechatCredentialStatus.FAILED,
    ]);
    expect(Object.values(WechatCredentialStatus)).toEqual([
      'IN_PROGRESS',
      'COMPLETED',
      'FAILED',
    ]);
    expect(columns.expiresAt.type).toBe('datetime');
    expect(columns.resourceUserId.type).toBe('bigint');
    expect(columns.resourceUserId.unsigned).toBe(true);
    expect(columns.resourceUserId.isNullable).toBe(true);
    expect(columns.responseSnapshot.type).toBe('json');
    expect(columns.responseSnapshot.isNullable).toBe(true);
    expect(
      metadata.indices.find(
        ({ givenName }) => givenName === 'idx_wechat_credential_uses_expires',
      ),
    ).toBeDefined();
  });
});
