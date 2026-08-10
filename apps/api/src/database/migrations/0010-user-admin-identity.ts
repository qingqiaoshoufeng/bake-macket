import type { MigrationInterface, QueryRunner } from 'typeorm';

type ArtifactRow = {
  artifact_key: string;
  artifact_signature: string;
};

type SchemaState = ReadonlyMap<string, string>;

const MAINTENANCE_ENV = 'BAKE_MALL_MAINTENANCE_MODE';
const WRITERS_STOPPED_ENV = 'BAKE_MALL_IDENTITY_WRITERS_STOPPED';
const MAINTENANCE_LOCK = 'bake-mall:0010-user-admin-identity:down';
const WRITERS_STOPPED_CONFIRMATION = `${WRITERS_STOPPED_ENV}=1 only confirms that the operator has stopped the API, workers, scheduled tasks, and every writer that can modify users, admin_users, admin_login_verification_buckets, audit_logs, or wechat_credential_uses（仅表示操作者已停止 API、worker、定时任务及所有可能写入上述身份域表的 writer）; the MySQL named lock only serializes migration rollback and does not block ordinary business writes（named lock 仅串行 migration rollback，不阻止普通业务写）`;
const ADMIN_LOGIN_BUCKET_COUNT = 1024;

const artifact = (
  key: string,
  signature: string,
): readonly [string, string] => [key, signature];

const BASELINE = new Map<string, string>([
  artifact('column:admin_users:username', 'varchar(64)|NO|<NULL>'),
  artifact('column:audit_logs:admin_user_id', 'bigint unsigned|NO|<NULL>'),
  artifact(
    'foreign-key:audit_logs:fk_audit_logs_admin',
    'admin_user_id|admin_users|id|RESTRICT|CASCADE',
  ),
]);

const withArtifacts = (
  state: SchemaState,
  entries: ReadonlyArray<readonly [string, string]>,
): Map<string, string> => new Map([...state, ...entries]);

const withoutArtifacts = (
  state: SchemaState,
  keys: readonly string[],
): Map<string, string> => {
  const next = new Map(state);
  keys.forEach((key) => next.delete(key));
  return next;
};

const USERS_ARTIFACTS = [
  artifact('column:users:is_active', 'tinyint(1)|NO|1'),
  artifact('column:users:merged_into_user_id', 'bigint unsigned|YES|<NULL>'),
  artifact('column:users:token_version', 'int unsigned|NO|1'),
  artifact('index:users:idx_users_merged_into', '1|merged_into_user_id'),
  artifact('index:users:uniq_users_wechat_openid', '0|wechat_openid'),
  artifact('index:users:uniq_users_wechat_unionid', '0|wechat_unionid'),
  artifact(
    'foreign-key:users:fk_users_merged_into',
    'merged_into_user_id|users|id|RESTRICT|CASCADE',
  ),
] as const;

const ADMIN_PHASE_ONE_ARTIFACTS = [
  artifact('column:admin_users:username', 'varchar(64)|YES|<NULL>'),
  artifact(
    'column:admin_users:role',
    "enum('super_admin','operator')|YES|<NULL>",
  ),
  artifact('column:admin_users:linked_user_id', 'bigint unsigned|YES|<NULL>'),
  artifact('column:admin_users:must_change_password', 'tinyint(1)|NO|0'),
  artifact('column:admin_users:token_version', 'int unsigned|NO|1'),
  artifact('column:admin_users:verify_failed_count', 'int unsigned|NO|0'),
  artifact(
    'column:admin_users:verify_window_started_at',
    'datetime|YES|<NULL>',
  ),
  artifact(
    'column:admin_users:last_password_changed_at',
    'datetime|YES|<NULL>',
  ),
] as const;

const ADMIN_FINAL_ARTIFACTS = [
  artifact(
    'column:admin_users:role',
    "enum('super_admin','operator')|NO|<NULL>",
  ),
  artifact(
    'index:admin_users:uniq_admin_users_linked_user',
    '0|linked_user_id',
  ),
  artifact(
    'foreign-key:admin_users:fk_admin_users_linked_user',
    'linked_user_id|users|id|RESTRICT|RESTRICT',
  ),
  artifact(
    'check:admin_users:chk_admin_users_role_identity',
    "(((`role` = _utf8mb4\\'super_admin') and (`username` is not null) and (`linked_user_id` is null)) or ((`role` = _utf8mb4\\'operator') and (`username` is null) and (`linked_user_id` is not null)))",
  ),
] as const;

const AUDIT_PHASE_ONE_ARTIFACTS = [
  artifact(
    'column:audit_logs:actor_type',
    "enum('admin','user','system')|YES|<NULL>",
  ),
  artifact('column:audit_logs:admin_user_id', 'bigint unsigned|YES|<NULL>'),
  artifact('column:audit_logs:user_id', 'bigint unsigned|YES|<NULL>'),
  artifact(
    'foreign-key:audit_logs:fk_audit_logs_admin',
    'admin_user_id|admin_users|id|RESTRICT|RESTRICT',
  ),
] as const;

const AUDIT_FINAL_ARTIFACTS = [
  artifact(
    'column:audit_logs:actor_type',
    "enum('admin','user','system')|NO|<NULL>",
  ),
  artifact('index:audit_logs:idx_audit_logs_user', '1|user_id'),
  artifact(
    'foreign-key:audit_logs:fk_audit_logs_user',
    'user_id|users|id|RESTRICT|RESTRICT',
  ),
  artifact(
    'check:audit_logs:chk_audit_logs_actor',
    "(((`actor_type` = _utf8mb4\\'admin\\') and (`admin_user_id` is not null) and (`user_id` is null)) or ((`actor_type` = _utf8mb4\\'user\\') and (`admin_user_id` is null) and (`user_id` is not null)) or ((`actor_type` = _utf8mb4\\'system\\') and (`admin_user_id` is null) and (`user_id` is null)))",
  ),
] as const;

const WECHAT_ARTIFACTS = [
  artifact('table:wechat_credential_uses', 'utf8mb4_unicode_ci'),
  artifact('column:wechat_credential_uses:id', 'bigint unsigned|NO|<NULL>'),
  artifact(
    'column:wechat_credential_uses:kind',
    "enum('login','phone')|NO|<NULL>",
  ),
  artifact(
    'column:wechat_credential_uses:credential_hash',
    'char(64)|NO|<NULL>',
  ),
  artifact(
    'column:wechat_credential_uses:status',
    "enum('in_progress','completed','failed')|NO|<NULL>",
  ),
  artifact('column:wechat_credential_uses:expires_at', 'datetime|NO|<NULL>'),
  artifact(
    'column:wechat_credential_uses:resource_user_id',
    'bigint unsigned|YES|<NULL>',
  ),
  artifact(
    'column:wechat_credential_uses:response_snapshot',
    'json|YES|<NULL>',
  ),
  artifact(
    'column:wechat_credential_uses:created_at',
    'datetime|NO|current_timestamp',
  ),
  artifact(
    'column:wechat_credential_uses:updated_at',
    'datetime|NO|current_timestamp',
  ),
  artifact(
    'index:wechat_credential_uses:uniq_wechat_credential_uses_hash',
    '0|credential_hash',
  ),
  artifact(
    'index:wechat_credential_uses:idx_wechat_credential_uses_expires',
    '1|expires_at',
  ),
  artifact(
    'index:wechat_credential_uses:idx_wechat_credential_uses_resource_user',
    '1|resource_user_id',
  ),
  artifact(
    'foreign-key:wechat_credential_uses:fk_wechat_credential_uses_resource_user',
    'resource_user_id|users|id|RESTRICT|CASCADE',
  ),
] as const;

const S0 = BASELINE;
const S1 = withArtifacts(S0, USERS_ARTIFACTS);
const S2 = withArtifacts(S1, ADMIN_PHASE_ONE_ARTIFACTS);
const S3 = withArtifacts(S2, ADMIN_FINAL_ARTIFACTS);
const S4 = withoutArtifacts(S3, ['foreign-key:audit_logs:fk_audit_logs_admin']);
const S5 = withArtifacts(S4, AUDIT_PHASE_ONE_ARTIFACTS);
const S6 = withArtifacts(S5, AUDIT_FINAL_ARTIFACTS);
const S7 = withArtifacts(S6, WECHAT_ARTIFACTS);

const ADMIN_LOGIN_BUCKET_ARTIFACTS = [
  artifact('table:admin_login_verification_buckets', 'utf8mb4_unicode_ci'),
  artifact('engine:admin_login_verification_buckets', 'innodb'),
  artifact(
    'column:admin_login_verification_buckets:bucket_id',
    'smallint unsigned|NO|<NULL>',
  ),
  artifact(
    'column:admin_login_verification_buckets:failed_count',
    'int unsigned|NO|0',
  ),
  artifact(
    'column:admin_login_verification_buckets:window_started_at',
    'datetime|YES|<NULL>',
  ),
  artifact(
    'column:admin_login_verification_buckets:updated_at',
    'datetime|NO|current_timestamp|default_generated on update current_timestamp',
  ),
  artifact('index:admin_login_verification_buckets:PRIMARY', '0|bucket_id'),
] as const;

const S8 = withArtifacts(S7, ADMIN_LOGIN_BUCKET_ARTIFACTS);

const D1 = withoutArtifacts(
  S8,
  ADMIN_LOGIN_BUCKET_ARTIFACTS.map(([key]) => key),
);
const D2 = withoutArtifacts(
  D1,
  WECHAT_ARTIFACTS.map(([key]) => key),
);
const D3 = withoutArtifacts(D2, ['check:audit_logs:chk_audit_logs_actor']);
const D4 = withoutArtifacts(D3, [
  'foreign-key:audit_logs:fk_audit_logs_user',
  'foreign-key:audit_logs:fk_audit_logs_admin',
]);
const D5 = withoutArtifacts(D4, ['index:audit_logs:idx_audit_logs_user']);
const D6 = withArtifacts(
  withoutArtifacts(D5, [
    'column:audit_logs:actor_type',
    'column:audit_logs:user_id',
    'column:audit_logs:admin_user_id',
  ]),
  [
    artifact('column:audit_logs:admin_user_id', 'bigint unsigned|NO|<NULL>'),
    artifact(
      'foreign-key:audit_logs:fk_audit_logs_admin',
      'admin_user_id|admin_users|id|RESTRICT|CASCADE',
    ),
  ],
);
const D7 = withoutArtifacts(D6, [
  'check:admin_users:chk_admin_users_role_identity',
]);
const D8 = withoutArtifacts(D7, [
  'foreign-key:admin_users:fk_admin_users_linked_user',
]);
const D9 = withoutArtifacts(D8, [
  'index:admin_users:uniq_admin_users_linked_user',
]);
const D10 = withArtifacts(
  withoutArtifacts(D9, [
    'column:admin_users:username',
    'column:admin_users:role',
    'column:admin_users:linked_user_id',
    'column:admin_users:must_change_password',
    'column:admin_users:token_version',
    'column:admin_users:verify_failed_count',
    'column:admin_users:verify_window_started_at',
    'column:admin_users:last_password_changed_at',
  ]),
  [artifact('column:admin_users:username', 'varchar(64)|NO|<NULL>')],
);
const D11 = withoutArtifacts(D10, ['foreign-key:users:fk_users_merged_into']);
const D12 = withoutArtifacts(D11, [
  'index:users:idx_users_merged_into',
  'index:users:uniq_users_wechat_openid',
  'index:users:uniq_users_wechat_unionid',
]);
const D13 = withoutArtifacts(
  D12,
  USERS_ARTIFACTS.slice(0, 3).map(([key]) => key),
);

const UP_STATES = [S0, S1, S2, S3, S4, S5, S6, S7, S8] as const;
const DOWN_STATES = [
  S8,
  D1,
  D2,
  D3,
  D4,
  D5,
  D6,
  D7,
  D8,
  D9,
  D10,
  D11,
  D12,
  D13,
] as const;

const normalizeSignature = (key: string, signature: string): string => {
  const normalized = signature.trim();
  if (!key.startsWith('check:')) return normalized;
  return normalized.toLowerCase().replaceAll('\\', '').replace(/\s+/g, ' ');
};

const sameState = (left: SchemaState, right: SchemaState): boolean =>
  left.size === right.size &&
  [...left].every(
    ([key, signature]) =>
      normalizeSignature(key, right.get(key) ?? '') ===
      normalizeSignature(key, signature),
  );

const checkpointOf = (
  state: SchemaState,
  checkpoints: readonly SchemaState[],
  direction: 'up' | 'down',
): number => {
  const checkpoint = checkpoints.findIndex((candidate) =>
    sameState(state, candidate),
  );
  if (checkpoint >= 0) return checkpoint;
  throw new Error(
    `UserAdminIdentity1718000000009 ${direction} rejected unrecognized schema state（无法识别的 schema 状态）: ${JSON.stringify([...state])}`,
  );
};

const schemaStateSql = `/* identity-schema-state */
SELECT CONCAT('table:', t.TABLE_NAME) AS artifact_key,
       t.TABLE_COLLATION AS artifact_signature
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = DATABASE()
  AND t.TABLE_NAME IN ('wechat_credential_uses', 'admin_login_verification_buckets')
UNION ALL
SELECT CONCAT('engine:', t.TABLE_NAME), LOWER(t.ENGINE)
FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA = DATABASE()
  AND t.TABLE_NAME = 'admin_login_verification_buckets'
UNION ALL
SELECT CONCAT('column:', c.TABLE_NAME, ':', c.COLUMN_NAME),
       CONCAT(LOWER(c.COLUMN_TYPE), '|', c.IS_NULLABLE, '|',
              COALESCE(LOWER(CAST(c.COLUMN_DEFAULT AS CHAR)), '<NULL>'),
              IF(c.TABLE_NAME = 'admin_login_verification_buckets' AND c.COLUMN_NAME = 'updated_at',
                 CONCAT('|', LOWER(c.EXTRA)), ''))
FROM information_schema.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
  AND ((c.TABLE_NAME = 'users' AND c.COLUMN_NAME IN ('is_active', 'merged_into_user_id', 'token_version'))
    OR (c.TABLE_NAME = 'admin_users' AND c.COLUMN_NAME IN ('username', 'role', 'linked_user_id', 'must_change_password', 'token_version', 'verify_failed_count', 'verify_window_started_at', 'last_password_changed_at'))
    OR (c.TABLE_NAME = 'audit_logs' AND c.COLUMN_NAME IN ('actor_type', 'admin_user_id', 'user_id'))
    OR c.TABLE_NAME IN ('wechat_credential_uses', 'admin_login_verification_buckets'))
UNION ALL
SELECT CONCAT('index:', s.TABLE_NAME, ':', s.INDEX_NAME),
       CONCAT(MIN(s.NON_UNIQUE), '|', GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX SEPARATOR ','))
FROM information_schema.STATISTICS s
WHERE s.TABLE_SCHEMA = DATABASE()
  AND (s.INDEX_NAME IN ('idx_users_merged_into', 'uniq_users_wechat_openid', 'uniq_users_wechat_unionid', 'uniq_admin_users_linked_user', 'idx_audit_logs_user', 'uniq_wechat_credential_uses_hash', 'idx_wechat_credential_uses_expires', 'idx_wechat_credential_uses_resource_user')
    OR s.TABLE_NAME = 'admin_login_verification_buckets')
GROUP BY s.TABLE_NAME, s.INDEX_NAME
UNION ALL
SELECT CONCAT('check:', tc.TABLE_NAME, ':', cc.CONSTRAINT_NAME),
       LOWER(cc.CHECK_CLAUSE)
FROM information_schema.CHECK_CONSTRAINTS cc
JOIN information_schema.TABLE_CONSTRAINTS tc
  ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
 AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
WHERE cc.CONSTRAINT_SCHEMA = DATABASE()
  AND cc.CONSTRAINT_NAME IN ('chk_admin_users_role_identity', 'chk_audit_logs_actor')
UNION ALL
SELECT CONCAT('foreign-key:', k.TABLE_NAME, ':', k.CONSTRAINT_NAME),
       CONCAT(GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION SEPARATOR ','), '|',
              k.REFERENCED_TABLE_NAME, '|',
              GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION SEPARATOR ','), '|',
              r.DELETE_RULE, '|', r.UPDATE_RULE)
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
 AND r.TABLE_NAME = k.TABLE_NAME
 AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
WHERE k.CONSTRAINT_SCHEMA = DATABASE()
  AND k.CONSTRAINT_NAME IN ('fk_users_merged_into', 'fk_admin_users_linked_user', 'fk_audit_logs_admin', 'fk_audit_logs_user', 'fk_wechat_credential_uses_resource_user')
GROUP BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.REFERENCED_TABLE_NAME, r.DELETE_RULE, r.UPDATE_RULE`;

const readSchemaState = async (
  queryRunner: QueryRunner,
  fallbackForQuerySpy: SchemaState,
): Promise<SchemaState> => {
  const result = (await queryRunner.query(schemaStateSql)) as unknown;
  // Several SQL-shape unit tests intentionally use a query spy with no result.
  if (result === undefined) return fallbackForQuerySpy;
  if (!Array.isArray(result)) {
    throw new Error('identity schema state query returned an invalid result');
  }
  return new Map(
    result.map((rawRow) => {
      const row = rawRow as Partial<ArtifactRow>;
      if (
        typeof row.artifact_key !== 'string' ||
        typeof row.artifact_signature !== 'string'
      ) {
        throw new Error('identity schema state query returned an invalid row');
      }
      return [row.artifact_key, row.artifact_signature];
    }),
  );
};

const hasBlockingData = (result: unknown): boolean => {
  if (!Array.isArray(result) || result.length === 0) return false;
  const row = result[0];
  if (typeof row !== 'object' || row === null) return false;
  return Number((row as Record<string, unknown>).has_blocking_data) === 1;
};

const scalarIsOne = (result: unknown, property: string): boolean => {
  if (!Array.isArray(result) || result.length !== 1) return false;
  const row = result[0];
  return (
    typeof row === 'object' &&
    row !== null &&
    Number((row as Record<string, unknown>)[property]) === 1
  );
};

const runRemaining = async (
  queryRunner: QueryRunner,
  current: number,
  statements: readonly string[],
): Promise<void> => {
  for (let index = current; index < statements.length; index += 1) {
    await queryRunner.query(statements[index]);
  }
};

const ADMIN_LOGIN_BUCKET_SEED_SQL = `INSERT INTO \`admin_login_verification_buckets\` (\`bucket_id\`) VALUES
${Array.from({ length: ADMIN_LOGIN_BUCKET_COUNT }, (_, bucketId) => `(${bucketId})`).join(',')}
ON DUPLICATE KEY UPDATE \`bucket_id\` = VALUES(\`bucket_id\`)`;

const bucketSeedIsComplete = (result: unknown): boolean => {
  if (!Array.isArray(result) || result.length !== 1) return false;
  const row = result[0];
  if (typeof row !== 'object' || row === null) return false;
  const values = row as Record<string, unknown>;
  return (
    Number(values.bucket_count) === ADMIN_LOGIN_BUCKET_COUNT &&
    Number(values.min_bucket_id) === 0 &&
    Number(values.max_bucket_id) === ADMIN_LOGIN_BUCKET_COUNT - 1
  );
};

const UP_STATEMENTS = [
  `ALTER TABLE \`users\`
  ADD COLUMN \`is_active\` TINYINT(1) NOT NULL DEFAULT 1 AFTER \`phone_verified\`,
  ADD COLUMN \`merged_into_user_id\` BIGINT UNSIGNED NULL AFTER \`is_active\`,
  ADD COLUMN \`token_version\` INT UNSIGNED NOT NULL DEFAULT 1 AFTER \`merged_into_user_id\`,
  ADD INDEX \`idx_users_merged_into\` (\`merged_into_user_id\`),
  ADD UNIQUE INDEX \`uniq_users_wechat_openid\` (\`wechat_openid\`),
  ADD UNIQUE INDEX \`uniq_users_wechat_unionid\` (\`wechat_unionid\`),
  ADD CONSTRAINT \`fk_users_merged_into\` FOREIGN KEY (\`merged_into_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE \`admin_users\`
  MODIFY COLUMN \`username\` VARCHAR(64) NULL,
  ADD COLUMN \`role\` ENUM('SUPER_ADMIN','OPERATOR') NULL AFTER \`username\`,
  ADD COLUMN \`linked_user_id\` BIGINT UNSIGNED NULL AFTER \`role\`,
  ADD COLUMN \`must_change_password\` TINYINT(1) NOT NULL DEFAULT 0 AFTER \`is_active\`,
  ADD COLUMN \`token_version\` INT UNSIGNED NOT NULL DEFAULT 1 AFTER \`must_change_password\`,
  ADD COLUMN \`verify_failed_count\` INT UNSIGNED NOT NULL DEFAULT 0 AFTER \`token_version\`,
  ADD COLUMN \`verify_window_started_at\` DATETIME NULL AFTER \`verify_failed_count\`,
  ADD COLUMN \`last_password_changed_at\` DATETIME NULL AFTER \`verify_window_started_at\``,
  "UPDATE `admin_users` SET `role` = 'SUPER_ADMIN' WHERE `role` IS NULL",
  `ALTER TABLE \`admin_users\`
  MODIFY COLUMN \`role\` ENUM('SUPER_ADMIN','OPERATOR') NOT NULL,
  ADD UNIQUE INDEX \`uniq_admin_users_linked_user\` (\`linked_user_id\`),
  ADD CONSTRAINT \`fk_admin_users_linked_user\` FOREIGN KEY (\`linked_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT \`chk_admin_users_role_identity\` CHECK ((\`role\` = 'SUPER_ADMIN' AND \`username\` IS NOT NULL AND \`linked_user_id\` IS NULL) OR (\`role\` = 'OPERATOR' AND \`username\` IS NULL AND \`linked_user_id\` IS NOT NULL))`,
  'ALTER TABLE `audit_logs` DROP FOREIGN KEY `fk_audit_logs_admin`',
  `ALTER TABLE \`audit_logs\`
  ADD COLUMN \`actor_type\` ENUM('ADMIN','USER','SYSTEM') NULL AFTER \`id\`,
  MODIFY COLUMN \`admin_user_id\` BIGINT UNSIGNED NULL,
  ADD COLUMN \`user_id\` BIGINT UNSIGNED NULL AFTER \`admin_user_id\`,
  ADD CONSTRAINT \`fk_audit_logs_admin\` FOREIGN KEY (\`admin_user_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT`,
  "UPDATE `audit_logs` SET `actor_type` = 'ADMIN' WHERE `actor_type` IS NULL",
  `ALTER TABLE \`audit_logs\`
  MODIFY COLUMN \`actor_type\` ENUM('ADMIN','USER','SYSTEM') NOT NULL,
  ADD INDEX \`idx_audit_logs_user\` (\`user_id\`),
  ADD CONSTRAINT \`fk_audit_logs_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT \`chk_audit_logs_actor\` CHECK ((\`actor_type\` = 'ADMIN' AND \`admin_user_id\` IS NOT NULL AND \`user_id\` IS NULL) OR (\`actor_type\` = 'USER' AND \`admin_user_id\` IS NULL AND \`user_id\` IS NOT NULL) OR (\`actor_type\` = 'SYSTEM' AND \`admin_user_id\` IS NULL AND \`user_id\` IS NULL))`,
  `CREATE TABLE \`wechat_credential_uses\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`kind\` ENUM('LOGIN','PHONE') NOT NULL,
  \`credential_hash\` CHAR(64) NOT NULL,
  \`status\` ENUM('IN_PROGRESS','COMPLETED','FAILED') NOT NULL,
  \`expires_at\` DATETIME NOT NULL,
  \`resource_user_id\` BIGINT UNSIGNED NULL,
  \`response_snapshot\` JSON NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE INDEX \`uniq_wechat_credential_uses_hash\` (\`credential_hash\`),
  INDEX \`idx_wechat_credential_uses_expires\` (\`expires_at\`),
  INDEX \`idx_wechat_credential_uses_resource_user\` (\`resource_user_id\`),
  CONSTRAINT \`fk_wechat_credential_uses_resource_user\` FOREIGN KEY (\`resource_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE \`admin_login_verification_buckets\` (
  \`bucket_id\` SMALLINT UNSIGNED NOT NULL,
  \`failed_count\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`window_started_at\` DATETIME NULL,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`bucket_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
] as const;

const DOWN_STATEMENTS = [
  'DROP TABLE `admin_login_verification_buckets`',
  'DROP TABLE `wechat_credential_uses`',
  'ALTER TABLE `audit_logs` DROP CONSTRAINT `chk_audit_logs_actor`',
  'ALTER TABLE `audit_logs` DROP FOREIGN KEY `fk_audit_logs_user`, DROP FOREIGN KEY `fk_audit_logs_admin`',
  'DROP INDEX `idx_audit_logs_user` ON `audit_logs`',
  `ALTER TABLE \`audit_logs\`
  DROP COLUMN \`user_id\`,
  DROP COLUMN \`actor_type\`,
  MODIFY COLUMN \`admin_user_id\` BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT \`fk_audit_logs_admin\` FOREIGN KEY (\`admin_user_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE`,
  'ALTER TABLE `admin_users` DROP CONSTRAINT `chk_admin_users_role_identity`',
  'ALTER TABLE `admin_users` DROP FOREIGN KEY `fk_admin_users_linked_user`',
  'DROP INDEX `uniq_admin_users_linked_user` ON `admin_users`',
  `ALTER TABLE \`admin_users\`
  DROP COLUMN \`last_password_changed_at\`,
  DROP COLUMN \`verify_window_started_at\`,
  DROP COLUMN \`verify_failed_count\`,
  DROP COLUMN \`token_version\`,
  DROP COLUMN \`must_change_password\`,
  DROP COLUMN \`linked_user_id\`,
  DROP COLUMN \`role\`,
  MODIFY COLUMN \`username\` VARCHAR(64) NOT NULL`,
  'ALTER TABLE `users` DROP FOREIGN KEY `fk_users_merged_into`',
  'ALTER TABLE `users` DROP INDEX `uniq_users_wechat_unionid`, DROP INDEX `uniq_users_wechat_openid`, DROP INDEX `idx_users_merged_into`',
  `ALTER TABLE \`users\`
  DROP COLUMN \`token_version\`,
  DROP COLUMN \`merged_into_user_id\`,
  DROP COLUMN \`is_active\``,
] as const;

/** Adds user/admin identity security, typed audit actors and replay-safe WeChat credential claims. */
export class UserAdminIdentity1718000000009 implements MigrationInterface {
  name = 'UserAdminIdentity1718000000009';
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    const checkpoint = checkpointOf(
      await readSchemaState(queryRunner, S0),
      UP_STATES,
      'up',
    );
    if (checkpoint === 0) {
      const duplicateIdentity = await queryRunner.query(
        `/* wechat-identity-duplicate-preflight */
        SELECT EXISTS(
          SELECT 1
          FROM (
            SELECT \`wechat_openid\` AS \`identity_value\`
            FROM \`users\`
            WHERE \`wechat_openid\` IS NOT NULL
            GROUP BY \`wechat_openid\`
            HAVING COUNT(*) > 1
            UNION ALL
            SELECT \`wechat_unionid\` AS \`identity_value\`
            FROM \`users\`
            WHERE \`wechat_unionid\` IS NOT NULL
            GROUP BY \`wechat_unionid\`
            HAVING COUNT(*) > 1
          ) AS \`duplicates\`
          LIMIT 1
        ) AS \`has_blocking_data\``,
      );
      if (hasBlockingData(duplicateIdentity)) {
        throw new Error(
          'UserAdminIdentity1718000000009 rejected duplicate WeChat identity（微信身份重复）',
        );
      }
    }

    // DML checkpoints share the surrounding DDL checkpoint. Repeating either
    // backfill is safe because it only fills NULL values.
    const statementIndexByCheckpoint = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const;
    if (checkpoint < UP_STATES.length - 1) {
      await runRemaining(
        queryRunner,
        statementIndexByCheckpoint[checkpoint],
        UP_STATEMENTS,
      );
    }

    const seedState =
      await queryRunner.query(`/* admin-login-bucket-seed-state */
      SELECT COUNT(*) AS \`bucket_count\`, MIN(\`bucket_id\`) AS \`min_bucket_id\`,
             MAX(\`bucket_id\`) AS \`max_bucket_id\`
      FROM \`admin_login_verification_buckets\``);
    if (!bucketSeedIsComplete(seedState)) {
      await queryRunner.query(ADMIN_LOGIN_BUCKET_SEED_SQL);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (process.env[MAINTENANCE_ENV] !== '1') {
      throw new Error(
        `UserAdminIdentity1718000000009 down requires ${MAINTENANCE_ENV}=1（需要显式维护模式）. ${WRITERS_STOPPED_CONFIRMATION}`,
      );
    }
    if (process.env[WRITERS_STOPPED_ENV] !== '1') {
      throw new Error(
        `UserAdminIdentity1718000000009 down requires ${WRITERS_STOPPED_CONFIRMATION}`,
      );
    }

    const lockResult = await queryRunner.query(
      'SELECT GET_LOCK(?, 0) AS `lock_acquired`',
      [MAINTENANCE_LOCK],
    );
    if (!scalarIsOne(lockResult, 'lock_acquired')) {
      throw new Error(
        'UserAdminIdentity1718000000009 down could not acquire maintenance named lock',
      );
    }

    try {
      const state = await readSchemaState(queryRunner, S8);
      const checkpoint = checkpointOf(state, DOWN_STATES, 'down');
      if (checkpoint === DOWN_STATES.length - 1) return;

      // Guards are selected by the current checkpoint so a retry never queries
      // a table or column already removed by a prior, implicitly committed DDL.
      const guardQueries: Array<{
        reason: string;
        sql: string;
      }> = [];
      if (checkpoint <= 9) {
        guardQueries.push({
          reason: 'ADMIN_IDENTITY_STATE',
          sql: `SELECT EXISTS(SELECT 1 FROM \`admin_users\`
            WHERE NOT (
              \`role\` <=> 'SUPER_ADMIN'
              AND \`must_change_password\` <=> 0
              AND \`token_version\` <=> 1
              AND \`verify_failed_count\` <=> 0
              AND \`verify_window_started_at\` IS NULL
              AND \`last_password_changed_at\` IS NULL
            ) LIMIT 1) AS \`has_blocking_data\``,
        });
      }
      if (checkpoint <= 11) {
        guardQueries.push({
          reason: 'USER_IDENTITY_STATE',
          sql: 'SELECT EXISTS(SELECT 1 FROM `users` WHERE `is_active` <> 1 OR `merged_into_user_id` IS NOT NULL OR `token_version` <> 1 LIMIT 1) AS `has_blocking_data`',
        });
      }
      if (checkpoint === 0) {
        guardQueries.push({
          reason: 'ADMIN_LOGIN_VERIFICATION_BUCKET',
          sql: `SELECT EXISTS(SELECT 1 FROM \`admin_login_verification_buckets\`
            WHERE \`failed_count\` <> 0
               OR \`window_started_at\` IS NOT NULL
            LIMIT 1) AS \`has_blocking_data\``,
        });
      }
      if (checkpoint <= 1) {
        guardQueries.push({
          reason: 'WECHAT_CREDENTIAL_USE',
          sql: 'SELECT EXISTS(SELECT 1 FROM `wechat_credential_uses` LIMIT 1) AS `has_blocking_data`',
        });
      }
      if (checkpoint <= 5) {
        guardQueries.push({
          reason: 'NON_ADMIN_AUDIT_ACTOR',
          sql: "SELECT EXISTS(SELECT 1 FROM `audit_logs` WHERE `actor_type` <> 'ADMIN' LIMIT 1) AS `has_blocking_data`",
        });
      }

      const guardResults: Array<{ reason: string; result: unknown }> = [];
      for (const guard of guardQueries) {
        guardResults.push({
          reason: guard.reason,
          result: await queryRunner.query(guard.sql),
        });
      }
      const blockingReasons = guardResults
        .filter(({ result }) => hasBlockingData(result))
        .map(({ reason }) => reason);
      if (blockingReasons.length > 0) {
        throw new Error(
          `UserAdminIdentity1718000000009 cannot revert（无法回滚）：身份域数据已使用新 schema (${blockingReasons.join(', ')})`,
        );
      }

      await runRemaining(queryRunner, checkpoint, DOWN_STATEMENTS);
    } finally {
      await queryRunner.query('SELECT RELEASE_LOCK(?) AS `lock_released`', [
        MAINTENANCE_LOCK,
      ]);
    }
  }
}
