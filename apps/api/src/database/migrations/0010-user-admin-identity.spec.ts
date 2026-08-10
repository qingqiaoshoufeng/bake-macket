import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserAdminIdentity1718000000009 } from './0010-user-admin-identity.js';

const statementsOf = (query: ReturnType<typeof vi.fn>): string[] =>
  query.mock.calls.map(([sql]) => String(sql));

const normalized = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const createTableDefinitions = (sql: string): string[] => {
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'));
  return body
    .split('\n')
    .map((line) => line.trim().replace(/,$/u, ''))
    .filter(Boolean);
};

const columnNamesOf = (definitions: string[]): string[] =>
  definitions.flatMap((definition) => {
    const match = definition.match(/^`([^`]+)`\s/u);
    return match ? [match[1]] : [];
  });

const indexesOf = (
  definitions: string[],
): Array<{ name: string; columns: string[] }> =>
  definitions.flatMap((definition) => {
    const match = definition.match(
      /^(?:PRIMARY KEY|(?:UNIQUE\s+)?(?:INDEX|KEY)\s+`([^`]+)`)\s*\(([^)]+)\)$/iu,
    );
    if (!match) return [];
    return [
      {
        name: match[1] ?? 'PRIMARY',
        columns: [...match[2].matchAll(/`([^`]+)`/gu)].map(
          ([, column]) => column,
        ),
      },
    ];
  });

type GuardFixture =
  | 'ADMIN_LOGIN_VERIFICATION_BUCKET'
  | 'ADMIN_ROLE_OPERATOR'
  | 'ADMIN_MUST_CHANGE_PASSWORD'
  | 'ADMIN_TOKEN_VERSION'
  | 'ADMIN_VERIFY_FAILED_COUNT'
  | 'ADMIN_VERIFY_WINDOW'
  | 'ADMIN_LAST_PASSWORD_CHANGE'
  | 'USER_TOMBSTONE'
  | 'WECHAT_USE'
  | 'USER_AUDIT';

type AdminIdentityFixture = Exclude<
  Extract<GuardFixture, `ADMIN_${string}`>,
  'ADMIN_LOGIN_VERIFICATION_BUCKET'
>;

const adminIdentityGuardFragment: Record<AdminIdentityFixture, RegExp> = {
  ADMIN_ROLE_OPERATOR: /`role`\s*<=>\s*'SUPER_ADMIN'/,
  ADMIN_MUST_CHANGE_PASSWORD: /`must_change_password`\s*<=>\s*0/,
  ADMIN_TOKEN_VERSION: /`token_version`\s*<=>\s*1/,
  ADMIN_VERIFY_FAILED_COUNT: /`verify_failed_count`\s*<=>\s*0/,
  ADMIN_VERIFY_WINDOW: /`verify_window_started_at`\s+IS\s+NULL/,
  ADMIN_LAST_PASSWORD_CHANGE: /`last_password_changed_at`\s+IS\s+NULL/,
};

type SchemaSnapshot = {
  tables: string[];
  columns: Record<string, string[]>;
  indexes: Record<string, string[]>;
  checks: Record<string, string[]>;
};

const upgradedSchema = (): SchemaSnapshot => ({
  tables: [
    'users',
    'admin_users',
    'admin_login_verification_buckets',
    'audit_logs',
    'wechat_credential_uses',
  ],
  columns: {
    users: ['is_active', 'merged_into_user_id', 'token_version'],
    admin_users: [
      'role',
      'linked_user_id',
      'must_change_password',
      'token_version',
      'verify_failed_count',
      'verify_window_started_at',
      'last_password_changed_at',
    ],
    audit_logs: ['actor_type', 'admin_user_id', 'user_id'],
    admin_login_verification_buckets: [
      'bucket_id',
      'failed_count',
      'window_started_at',
      'updated_at',
    ],
    wechat_credential_uses: [
      'id',
      'kind',
      'credential_hash',
      'status',
      'expires_at',
      'resource_user_id',
      'response_snapshot',
      'created_at',
      'updated_at',
    ],
  },
  indexes: {
    users: ['idx_users_merged_into'],
    admin_users: ['uniq_admin_users_username', 'uniq_admin_users_linked_user'],
    audit_logs: ['idx_audit_logs_admin', 'idx_audit_logs_user'],
    admin_login_verification_buckets: [],
    wechat_credential_uses: [
      'uniq_wechat_credential_uses_hash',
      'idx_wechat_credential_uses_expires',
      'idx_wechat_credential_uses_resource_user',
    ],
  },
  checks: {
    admin_users: ['chk_admin_users_role_identity'],
    audit_logs: ['chk_audit_logs_actor'],
  },
});

const guardResult = (sql: string, fixture?: GuardFixture): unknown[] => {
  if (/FROM `admin_login_verification_buckets`/.test(sql)) {
    return [
      {
        has_blocking_data:
          fixture === 'ADMIN_LOGIN_VERIFICATION_BUCKET' ? 1 : 0,
      },
    ];
  }
  if (/FROM `admin_users`/.test(sql)) {
    const isBlocked =
      fixture !== undefined &&
      fixture in adminIdentityGuardFragment &&
      adminIdentityGuardFragment[fixture as AdminIdentityFixture].test(sql);
    return [{ has_blocking_data: isBlocked ? 1 : 0 }];
  }
  if (/FROM `users`/.test(sql)) {
    return [{ has_blocking_data: fixture === 'USER_TOMBSTONE' ? 1 : 0 }];
  }
  if (/FROM `wechat_credential_uses`/.test(sql)) {
    return [{ has_blocking_data: fixture === 'WECHAT_USE' ? 1 : 0 }];
  }
  if (/FROM `audit_logs`/.test(sql)) {
    return [{ has_blocking_data: fixture === 'USER_AUDIT' ? 1 : 0 }];
  }
  return [];
};

const statefulRunner = (fixture?: GuardFixture) => {
  let schema = upgradedSchema();
  const ddl: string[] = [];
  const query = vi.fn(async (rawSql: string) => {
    const sql = String(rawSql);
    if (sql.includes('identity-schema-state')) return undefined;
    if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
    if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
    if (/^\s*SELECT\b/i.test(sql)) return guardResult(sql, fixture);

    ddl.push(sql);
    schema = {
      ...schema,
      tables: sql.includes('DROP TABLE `admin_login_verification_buckets`')
        ? schema.tables.filter(
            (table) => table !== 'admin_login_verification_buckets',
          )
        : sql.includes('DROP TABLE `wechat_credential_uses`')
          ? schema.tables.filter((table) => table !== 'wechat_credential_uses')
          : schema.tables,
    };
    return undefined;
  });

  return {
    query,
    ddl,
    snapshot: (): SchemaSnapshot => structuredClone(schema),
  };
};

describe('UserAdminIdentity1718000000009', () => {
  let previousMaintenanceMode: string | undefined;
  let previousWritersStopped: string | undefined;

  beforeEach(() => {
    previousMaintenanceMode = process.env.BAKE_MALL_MAINTENANCE_MODE;
    previousWritersStopped = process.env.BAKE_MALL_IDENTITY_WRITERS_STOPPED;
    process.env.BAKE_MALL_MAINTENANCE_MODE = '1';
    process.env.BAKE_MALL_IDENTITY_WRITERS_STOPPED = '1';
  });

  afterEach(() => {
    if (previousMaintenanceMode === undefined) {
      delete process.env.BAKE_MALL_MAINTENANCE_MODE;
    } else {
      process.env.BAKE_MALL_MAINTENANCE_MODE = previousMaintenanceMode;
    }
    if (previousWritersStopped === undefined) {
      delete process.env.BAKE_MALL_IDENTITY_WRITERS_STOPPED;
    } else {
      process.env.BAKE_MALL_IDENTITY_WRITERS_STOPPED = previousWritersStopped;
    }
  });

  it('up 在首条 DDL 前读取真实 schema 状态', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new UserAdminIdentity1718000000009().up({ query } as never);

    expect(String(query.mock.calls[0]?.[0])).toContain('identity-schema-state');
  });

  it('schema checkpoint 读取 bucket engine、全部索引及 updated_at ON UPDATE 元数据', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new UserAdminIdentity1718000000009().up({ query } as never);

    const checkpointSql = String(query.mock.calls[0]?.[0]);
    expect(checkpointSql).toMatch(/LOWER\(t\.ENGINE\)/i);
    expect(checkpointSql).toContain(
      "s.TABLE_NAME = 'admin_login_verification_buckets'",
    );
    expect(checkpointSql).toMatch(/LOWER\(c\.EXTRA\)/i);
  });

  it('up 遇到无法识别的 schema 状态时在任何 DDL 前拒绝', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        kind: 'COLUMN',
        table_name: 'users',
        artifact_name: 'is_active',
        column_type: 'tinyint(1)',
        is_nullable: 'NO',
        column_default: '9',
      },
    ]);

    await expect(
      new UserAdminIdentity1718000000009().up({ query } as never),
    ).rejects.toThrow(/schema state|状态/i);

    expect(
      statementsOf(query).some((sql) => /^(ALTER|CREATE|DROP)\b/i.test(sql)),
    ).toBe(false);
  });

  it('up 在 users 存在重复微信 identity 时于任何 DDL 前拒绝', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('identity-schema-state')) return undefined;
      if (sql.includes('wechat-identity-duplicate-preflight')) {
        return [{ has_blocking_data: 1 }];
      }
      return undefined;
    });

    await expect(
      new UserAdminIdentity1718000000009().up({ query } as never),
    ).rejects.toThrow(/duplicate.*wechat|微信身份重复/i);

    expect(
      statementsOf(query).some((sql) => /^(ALTER|CREATE|DROP)\b/i.test(sql)),
    ).toBe(false);
  });

  it('扩展 users，并以微信唯一索引、显式索引和 RESTRICT 自引用保留 tombstone', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new UserAdminIdentity1718000000009().up({ query } as never);

    const sql = normalized(statementsOf(query).join('\n'));
    expect(sql).toContain('`is_active` TINYINT(1) NOT NULL DEFAULT 1');
    expect(sql).toContain('`merged_into_user_id` BIGINT UNSIGNED NULL');
    expect(sql).toContain('`token_version` INT UNSIGNED NOT NULL DEFAULT 1');
    expect(sql).toContain(
      'INDEX `idx_users_merged_into` (`merged_into_user_id`)',
    );
    expect(sql).toContain(
      'UNIQUE INDEX `uniq_users_wechat_openid` (`wechat_openid`)',
    );
    expect(sql).toContain(
      'UNIQUE INDEX `uniq_users_wechat_unionid` (`wechat_unionid`)',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_users_merged_into` FOREIGN KEY (`merged_into_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
  });

  it('回填现有 admin 为 SUPER_ADMIN 并建立完整角色身份 CHECK', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new UserAdminIdentity1718000000009().up({ query } as never);

    const statements = statementsOf(query).map(normalized);
    const sql = statements.join('\n');
    const backfillIndex = statements.findIndex((statement) =>
      statement.includes("UPDATE `admin_users` SET `role` = 'SUPER_ADMIN'"),
    );
    const notNullIndex = statements.findIndex((statement) =>
      statement.includes(
        "MODIFY COLUMN `role` ENUM('SUPER_ADMIN','OPERATOR') NOT NULL",
      ),
    );

    expect(sql).toContain('MODIFY COLUMN `username` VARCHAR(64) NULL');
    expect(sql).toContain('`linked_user_id` BIGINT UNSIGNED NULL');
    expect(sql).toContain(
      '`must_change_password` TINYINT(1) NOT NULL DEFAULT 0',
    );
    expect(sql).toContain('`token_version` INT UNSIGNED NOT NULL DEFAULT 1');
    expect(sql).toContain(
      '`verify_failed_count` INT UNSIGNED NOT NULL DEFAULT 0',
    );
    expect(sql).toContain('`verify_window_started_at` DATETIME NULL');
    expect(sql).toContain('`last_password_changed_at` DATETIME NULL');
    expect(sql).toContain(
      'UNIQUE INDEX `uniq_admin_users_linked_user` (`linked_user_id`)',
    );
    expect(sql).toContain(
      'FOREIGN KEY (`linked_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      "CHECK ((`role` = 'SUPER_ADMIN' AND `username` IS NOT NULL AND `linked_user_id` IS NULL) OR (`role` = 'OPERATOR' AND `username` IS NULL AND `linked_user_id` IS NOT NULL))",
    );
    expect(backfillIndex).toBeGreaterThanOrEqual(0);
    expect(notNullIndex).toBeGreaterThan(backfillIndex);
  });

  it('无损升级 audit actor，并用精确 CHECK 约束三种 actor', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new UserAdminIdentity1718000000009().up({ query } as never);

    const statements = statementsOf(query).map(normalized);
    const sql = statements.join('\n');
    const backfillIndex = statements.findIndex((statement) =>
      statement.includes("UPDATE `audit_logs` SET `actor_type` = 'ADMIN'"),
    );
    const actorNotNullIndex = statements.findIndex((statement) =>
      statement.includes(
        "MODIFY COLUMN `actor_type` ENUM('ADMIN','USER','SYSTEM') NOT NULL",
      ),
    );

    expect(sql).toContain('DROP FOREIGN KEY `fk_audit_logs_admin`');
    expect(sql).toContain('MODIFY COLUMN `admin_user_id` BIGINT UNSIGNED NULL');
    expect(sql).toContain('`user_id` BIGINT UNSIGNED NULL');
    expect(sql).toContain(
      'FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain('INDEX `idx_audit_logs_user` (`user_id`)');
    expect(sql).toContain(
      'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      "CHECK ((`actor_type` = 'ADMIN' AND `admin_user_id` IS NOT NULL AND `user_id` IS NULL) OR (`actor_type` = 'USER' AND `admin_user_id` IS NULL AND `user_id` IS NOT NULL) OR (`actor_type` = 'SYSTEM' AND `admin_user_id` IS NULL AND `user_id` IS NULL))",
    );
    expect(backfillIndex).toBeGreaterThanOrEqual(0);
    expect(actorNotNullIndex).toBeGreaterThan(backfillIndex);
  });

  it('创建固定公开登录 bucket 表并预置完整 0..1023 默认行', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new UserAdminIdentity1718000000009().up({ query } as never);

    const statements = statementsOf(query);
    const create = statements.find((sql) =>
      sql.includes('CREATE TABLE `admin_login_verification_buckets`'),
    );
    expect(create).toBeDefined();
    const sql = normalized(create ?? '');
    expect(sql).toContain('`bucket_id` SMALLINT UNSIGNED NOT NULL');
    expect(sql).toContain('PRIMARY KEY (`bucket_id`)');
    expect(sql).toContain('`failed_count` INT UNSIGNED NOT NULL DEFAULT 0');
    expect(sql).toContain('`window_started_at` DATETIME NULL');
    expect(sql).toContain(
      '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    );
    const definitions = createTableDefinitions(create ?? '');
    expect(columnNamesOf(definitions)).toEqual([
      'bucket_id',
      'failed_count',
      'window_started_at',
      'updated_at',
    ]);
    expect(indexesOf(definitions)).toEqual([
      { name: 'PRIMARY', columns: ['bucket_id'] },
    ]);
    expect(sql).toContain('ENGINE=InnoDB');
    expect(sql).toContain('CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    expect(sql).not.toMatch(
      /`(?:identifier|email|phone|kind|hash|subject_hash)`\s/i,
    );

    const seed = normalized(
      statements.find((statement) =>
        statement.includes('INSERT INTO `admin_login_verification_buckets`'),
      ) ?? '',
    );
    expect(seed).toContain('(`bucket_id`) VALUES');
    const ids = [...seed.matchAll(/\((\d+)\)/g)].map(([, id]) => Number(id));
    expect(ids).toHaveLength(1024);
    expect(ids).toEqual(Array.from({ length: 1024 }, (_, index) => index));
    expect(seed).toContain(
      'ON DUPLICATE KEY UPDATE `bucket_id` = VALUES(`bucket_id`)',
    );
  });

  it('up 在 bucket seed 不完整时用幂等 DML 补种缺失行', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('identity-schema-state')) return undefined;
      if (sql.includes('admin-login-bucket-seed-state')) {
        return [{ bucket_count: 1023, min_bucket_id: 0, max_bucket_id: 1022 }];
      }
      return undefined;
    });

    await new UserAdminIdentity1718000000009().up({ query } as never);

    const statements = statementsOf(query);
    expect(
      statements.filter((sql) =>
        sql.includes('CREATE TABLE `admin_login_verification_buckets`'),
      ),
    ).toHaveLength(1);
    expect(
      statements.filter((sql) =>
        sql.includes('INSERT INTO `admin_login_verification_buckets`'),
      ),
    ).toHaveLength(1);
  });

  it('创建只保存 SHA-256 hash 且支持条件 claim 的微信凭证表', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new UserAdminIdentity1718000000009().up({ query } as never);

    const create = statementsOf(query).find((sql) =>
      sql.includes('CREATE TABLE `wechat_credential_uses`'),
    );
    expect(create).toBeDefined();
    const sql = normalized(create ?? '');
    expect(sql).toContain('`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    expect(sql).toContain("`kind` ENUM('LOGIN','PHONE') NOT NULL");
    expect(sql).toContain('`credential_hash` CHAR(64) NOT NULL');
    expect(sql).toContain(
      "`status` ENUM('IN_PROGRESS','COMPLETED','FAILED') NOT NULL",
    );
    expect(sql).toContain('`expires_at` DATETIME NOT NULL');
    expect(sql).toContain('`resource_user_id` BIGINT UNSIGNED NULL');
    expect(sql).toContain('`response_snapshot` JSON NULL');
    expect(sql).toContain('UNIQUE INDEX `uniq_wechat_credential_uses_hash`');
    expect(sql).toContain('INDEX `idx_wechat_credential_uses_expires`');
    expect(sql).toContain('ENGINE=InnoDB');
    expect(sql).toContain('CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    expect(sql).not.toMatch(/`(?:credential|code|login_code|phone_code)`\s/i);
  });

  it.each([
    ['缺少 maintenance 确认', undefined, '1', /BAKE_MALL_MAINTENANCE_MODE=1/],
    ['maintenance 确认值错误', 'true', '1', /BAKE_MALL_MAINTENANCE_MODE=1/],
    [
      '缺少 writer 停止确认',
      '1',
      undefined,
      /BAKE_MALL_IDENTITY_WRITERS_STOPPED=1/,
    ],
    [
      'writer 停止确认值错误',
      '1',
      'true',
      /BAKE_MALL_IDENTITY_WRITERS_STOPPED=1/,
    ],
  ] as const)(
    'down 在%s时于任何 query 前 fail closed',
    async (_case, maintenanceMode, writersStopped, expectedMessage) => {
      if (maintenanceMode === undefined) {
        delete process.env.BAKE_MALL_MAINTENANCE_MODE;
      } else {
        process.env.BAKE_MALL_MAINTENANCE_MODE = maintenanceMode;
      }
      if (writersStopped === undefined) {
        delete process.env.BAKE_MALL_IDENTITY_WRITERS_STOPPED;
      } else {
        process.env.BAKE_MALL_IDENTITY_WRITERS_STOPPED = writersStopped;
      }
      const query = vi.fn();

      await expect(
        new UserAdminIdentity1718000000009().down({ query } as never),
      ).rejects.toThrow(expectedMessage);

      expect(query).not.toHaveBeenCalled();
    },
  );

  it('down 双确认满足后才获取 named lock 并继续', async () => {
    const runner = statefulRunner();

    await new UserAdminIdentity1718000000009().down(runner as never);

    expect(statementsOf(runner.query)[0]).toContain('GET_LOCK');
  });

  it.each([
    ['ADMIN_LOGIN_VERIFICATION_BUCKET'],
    ['ADMIN_ROLE_OPERATOR'],
    ['ADMIN_MUST_CHANGE_PASSWORD'],
    ['ADMIN_TOKEN_VERSION'],
    ['ADMIN_VERIFY_FAILED_COUNT'],
    ['ADMIN_VERIFY_WINDOW'],
    ['ADMIN_LAST_PASSWORD_CHANGE'],
    ['USER_TOMBSTONE'],
    ['WECHAT_USE'],
    ['USER_AUDIT'],
  ] as const)(
    'down 在存在 %s 时于任何 DDL 前拒绝且 schema 零变化',
    async (fixture) => {
      const runner = statefulRunner(fixture);
      const before = runner.snapshot();

      await expect(
        new UserAdminIdentity1718000000009().down(runner as never),
      ).rejects.toThrow(
        fixture === 'ADMIN_LOGIN_VERIFICATION_BUCKET'
          ? /ADMIN_LOGIN_VERIFICATION_BUCKET/
          : fixture.startsWith('ADMIN_')
            ? /ADMIN_IDENTITY_STATE/
            : /cannot revert|无法回滚/i,
      );

      expect(
        statementsOf(runner.query).every((sql) =>
          /^\s*(?:\/\*[^]*?\*\/\s*)?SELECT\b/i.test(sql),
        ),
      ).toBe(true);
      expect(runner.ddl).toEqual([]);
      expect(runner.snapshot()).toEqual(before);
    },
  );

  it('down 先完成全部只读 guard，再按 FK 顺序恢复旧 schema', async () => {
    const runner = statefulRunner();

    await new UserAdminIdentity1718000000009().down(runner as never);

    const statements = statementsOf(runner.query);
    const firstDdlIndex = statements.findIndex((sql) =>
      sql.includes('DROP TABLE `admin_login_verification_buckets`'),
    );
    expect(firstDdlIndex).toBeGreaterThan(0);
    expect(
      statements
        .slice(0, firstDdlIndex)
        .every((sql) => /^\s*(?:\/\*[^]*?\*\/\s*)?SELECT\b/i.test(sql)),
    ).toBe(true);
    const sql = normalized(statements.join('\n'));
    expect(sql).toContain('DROP CONSTRAINT `chk_audit_logs_actor`');
    expect(sql).toContain(
      'MODIFY COLUMN `admin_user_id` BIGINT UNSIGNED NOT NULL',
    );
    expect(sql).toContain(
      'FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain('DROP COLUMN `actor_type`');
    expect(sql).toContain('DROP CONSTRAINT `chk_admin_users_role_identity`');
    expect(sql).toContain('MODIFY COLUMN `username` VARCHAR(64) NOT NULL');
    expect(sql).toContain('DROP COLUMN `merged_into_user_id`');
    expect(sql).toContain('DROP INDEX `uniq_users_wechat_openid`');
    expect(sql).toContain('DROP INDEX `uniq_users_wechat_unionid`');
  });
});
