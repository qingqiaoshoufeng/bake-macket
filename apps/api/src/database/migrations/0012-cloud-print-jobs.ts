import type { MigrationInterface, QueryRunner } from 'typeorm';

const hasBlockingData = (result: unknown): boolean => {
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('0012 down guard returned an invalid result');
  }
  const row = result[0];
  if (typeof row !== 'object' || row === null) {
    throw new Error('0012 down guard returned an invalid row');
  }
  const value = Number((row as Record<string, unknown>).has_blocking_data);
  if (value !== 0 && value !== 1) {
    throw new Error('0012 down guard returned an invalid flag');
  }
  return value === 1;
};

const PRINTING_MAINTENANCE_ENV = 'BAKE_MALL_MAINTENANCE_MODE';
const PRINTING_WRITERS_STOPPED_ENV = 'BAKE_MALL_PRINTING_WRITERS_STOPPED';
const PRINTING_DOWN_CONFIRMATION =
  '0012 down requires BAKE_MALL_MAINTENANCE_MODE=1 and BAKE_MALL_PRINTING_WRITERS_STOPPED=1（必须明确维护模式并停止所有写入）';
const STAGING_PRINT_BATCHES = '__0012_print_batches_staging';
const STAGING_PRINT_JOBS = '__0012_print_jobs_staging';
const STAGING_OWNERSHIP_MARKER = 'bake-mall:0012-cloud-print-jobs:staging:v1';
const MIGRATION_ADVISORY_LOCK = 'bake-mall:migration:0012-cloud-print-jobs';
const MIGRATION_ADVISORY_LOCK_TIMEOUT_SECONDS = 10;
const STAGING_MINIMUM_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  [STAGING_PRINT_BATCHES]: ['id', 'printer_id', 'created_by_admin_id'],
  [STAGING_PRINT_JOBS]: [
    'id',
    'batch_id',
    'order_id',
    'printer_id',
    'created_by_admin_id',
  ],
};

function ensurePrintingWritersStopped(): void {
  if (process.env[PRINTING_MAINTENANCE_ENV] !== '1') {
    throw new Error(
      `${PRINTING_MAINTENANCE_ENV} 未开启：${PRINTING_DOWN_CONFIRMATION}`,
    );
  }
  if (process.env[PRINTING_WRITERS_STOPPED_ENV] !== '1') {
    throw new Error(
      `${PRINTING_WRITERS_STOPPED_ENV} 未开启：${PRINTING_DOWN_CONFIRMATION}`,
    );
  }
}

const queryScalar = (result: unknown, key: string): number => {
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error(`0012 migration lock returned an invalid ${key} result`);
  }
  const row = result[0];
  if (typeof row !== 'object' || row === null) {
    throw new Error(`0012 migration lock returned an invalid ${key} row`);
  }
  const value = Number((row as Record<string, unknown>)[key]);
  if (!Number.isInteger(value)) {
    throw new Error(`0012 migration lock returned an invalid ${key} value`);
  }
  return value;
};

async function acquireMigrationLock(queryRunner: QueryRunner): Promise<void> {
  const result = await queryRunner.query(
    `SELECT GET_LOCK('${MIGRATION_ADVISORY_LOCK}', ${MIGRATION_ADVISORY_LOCK_TIMEOUT_SECONDS}) AS \`lock_acquired\``,
  );
  if (queryScalar(result, 'lock_acquired') !== 1) {
    throw new Error(
      `0012 migration advisory lock unavailable（迁移锁获取失败或超时）：${MIGRATION_ADVISORY_LOCK}`,
    );
  }
}

async function releaseMigrationLock(queryRunner: QueryRunner): Promise<void> {
  const result = await queryRunner.query(
    `SELECT RELEASE_LOCK('${MIGRATION_ADVISORY_LOCK}') AS \`lock_released\``,
  );
  if (queryScalar(result, 'lock_released') !== 1) {
    throw new Error(
      `0012 migration advisory lock release failed（迁移锁释放失败）：${MIGRATION_ADVISORY_LOCK}`,
    );
  }
}

type ErrorWithSuppressed = { suppressed?: readonly unknown[] };

const attachSuppressedError = (
  primaryError: unknown,
  suppressedError: unknown,
): unknown => {
  if (
    (typeof primaryError === 'object' && primaryError !== null) ||
    typeof primaryError === 'function'
  ) {
    try {
      const error = primaryError as ErrorWithSuppressed;
      Object.defineProperty(error, 'suppressed', {
        configurable: true,
        enumerable: false,
        value: [...(error.suppressed ?? []), suppressedError],
        writable: true,
      });
      return primaryError;
    } catch {
      // Fall through for frozen or otherwise non-extensible thrown values.
    }
  }
  return new AggregateError(
    [primaryError, suppressedError],
    '0012 migration failed and cleanup also failed',
    { cause: primaryError },
  );
};

async function runWithCleanupPreservingError<T>(
  body: () => Promise<T>,
  cleanupActions: readonly (() => Promise<void>)[],
): Promise<T> {
  let result!: T;
  let primaryError: unknown;
  let failed = false;

  try {
    result = await body();
  } catch (error) {
    primaryError = error;
    failed = true;
  }

  for (const cleanup of cleanupActions) {
    try {
      await cleanup();
    } catch (cleanupError) {
      if (failed) {
        primaryError = attachSuppressedError(primaryError, cleanupError);
      } else {
        primaryError = cleanupError;
        failed = true;
      }
    }
  }

  if (failed) throw primaryError;
  return result;
}

async function verifyStagingTableOwnership(
  queryRunner: QueryRunner,
  tableName: string,
): Promise<boolean> {
  const minimumColumns = STAGING_MINIMUM_COLUMNS[tableName];
  if (!minimumColumns)
    throw new Error(`Unknown 0012 staging table: ${tableName}`);
  const placeholders = minimumColumns.map(() => '?').join(', ');
  const result = await queryRunner.query(
    `SELECT t.TABLE_COMMENT AS \`table_comment\`,
       COUNT(DISTINCT c.COLUMN_NAME) AS \`matched_columns\`
     FROM information_schema.TABLES t
     LEFT JOIN information_schema.COLUMNS c
       ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
      AND c.TABLE_NAME = t.TABLE_NAME
      AND c.COLUMN_NAME IN (${placeholders})
     WHERE t.TABLE_SCHEMA = DATABASE()
       AND t.TABLE_NAME = ?
       AND t.TABLE_TYPE = 'BASE TABLE'
     GROUP BY t.TABLE_COMMENT`,
    [...minimumColumns, tableName],
  );
  if (!Array.isArray(result) || result.length === 0) return false;
  if (result.length !== 1) {
    throw new Error(
      `0012 staging ownership check returned multiple rows for ${tableName}`,
    );
  }
  const row = result[0];
  const comment =
    typeof row === 'object' && row !== null
      ? String((row as Record<string, unknown>).table_comment ?? '')
      : '';
  const matchedColumns =
    typeof row === 'object' && row !== null
      ? Number((row as Record<string, unknown>).matched_columns)
      : Number.NaN;
  if (
    comment !== STAGING_OWNERSHIP_MARKER ||
    matchedColumns !== minimumColumns.length
  ) {
    throw new Error(
      `0012 staging table ownership marker/expected minimum structure mismatch for ${tableName}; refusing to drop it（staging 表所有权标记或最小结构不匹配，拒绝删除）`,
    );
  }
  return true;
}

async function cleanupOwnedStagingTables(
  queryRunner: QueryRunner,
): Promise<void> {
  const ownedTables = [] as string[];
  for (const tableName of [STAGING_PRINT_JOBS, STAGING_PRINT_BATCHES]) {
    if (await verifyStagingTableOwnership(queryRunner, tableName)) {
      ownedTables.push(tableName);
    }
  }
  if (ownedTables.length > 0) {
    await queryRunner.query(
      `DROP TABLE IF EXISTS ${ownedTables.map((table) => `\`${table}\``).join(', ')}`,
    );
  }
}

/** Adds durable cloud print batches and immutable print intent jobs. */
export class CloudPrintJobs1718000000011 implements MigrationInterface {
  name = 'CloudPrintJobs1718000000011';
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await acquireMigrationLock(queryRunner);
    await runWithCleanupPreservingError(async () => {
      await cleanupOwnedStagingTables(queryRunner);

      await queryRunner.query(
        `CREATE TABLE \`${STAGING_PRINT_BATCHES}\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`printer_id\` BIGINT UNSIGNED NOT NULL,
  \`created_by_admin_id\` BIGINT UNSIGNED NOT NULL,
  \`status\` ENUM('DRAFT','READY','RUNNING','PAUSED','COMPLETED','COMPLETED_WITH_ISSUES','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  \`lease_owner\` VARCHAR(128) NULL,
  \`lease_expires_at\` DATETIME NULL,
  \`total_count\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`classified_count\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`accepted_count\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`failed_count\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`manual_review_count\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`manually_resolved_count\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`cancelled_count\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  INDEX \`idx_print_batches_queue\` (\`status\`, \`lease_expires_at\`, \`id\`),
  INDEX \`idx_print_batches_lease\` (\`lease_owner\`, \`lease_expires_at\`),
  INDEX \`idx_print_batches_printer\` (\`printer_id\`),
  INDEX \`idx_print_batches_created_by_admin\` (\`created_by_admin_id\`),
  CONSTRAINT \`chk_print_batches_classified_count\` CHECK (\`classified_count\` = \`accepted_count\` + \`failed_count\` + \`manually_resolved_count\` + \`cancelled_count\`),
  CONSTRAINT \`chk_print_batches_progress_count\` CHECK (\`classified_count\` + \`manual_review_count\` <= \`total_count\`),
  CONSTRAINT \`fk_print_batches_printer\` FOREIGN KEY (\`printer_id\`) REFERENCES \`cloud_printers\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT \`fk_print_batches_created_by_admin\` FOREIGN KEY (\`created_by_admin_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='bake-mall:0012-cloud-print-jobs:staging:v1'`,
      );

      await queryRunner.query(
        `CREATE TABLE \`${STAGING_PRINT_JOBS}\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`batch_id\` BIGINT UNSIGNED NOT NULL,
  \`order_id\` BIGINT UNSIGNED NOT NULL,
  \`printer_id\` BIGINT UNSIGNED NOT NULL,
  \`sequence\` INT UNSIGNED NOT NULL,
  \`status\` ENUM('PENDING','SUBMITTING','ACCEPTED','FAILED','UNKNOWN','MANUAL_REVIEW','MANUALLY_CONFIRMED_PRINTED','MANUALLY_CLOSED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  \`payload_json\` JSON NULL,
  \`payload_hash\` CHAR(64) NOT NULL,
  \`payload_redacted_at\` DATETIME NULL,
  \`vendor_job_id\` VARCHAR(128) NULL,
  \`vendor_error_code\` VARCHAR(64) NULL,
  \`accepted_at\` DATETIME NULL,
  \`unknown_since_at\` DATETIME NULL,
  \`unknown_query_count\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`last_unknown_query_at\` DATETIME NULL,
  \`created_by_admin_id\` BIGINT UNSIGNED NOT NULL,
  \`manual_resolution\` ENUM('CONFIRM_PRINTED','CONFIRM_NOT_PRINTED','RETRY_WITH_DUPLICATE_RISK') NULL,
  \`manual_resolution_by_admin_id\` BIGINT UNSIGNED NULL,
  \`manual_resolution_at\` DATETIME NULL,
  \`supersedes_job_id\` BIGINT UNSIGNED NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE INDEX \`uniq_print_jobs_batch_order\` (\`batch_id\`, \`order_id\`),
  UNIQUE INDEX \`uniq_print_jobs_order_sequence\` (\`order_id\`, \`sequence\`),
  INDEX \`idx_print_jobs_queue\` (\`batch_id\`, \`status\`, \`sequence\`),
  INDEX \`idx_print_jobs_printer\` (\`printer_id\`),
  INDEX \`idx_print_jobs_created_by_admin\` (\`created_by_admin_id\`),
  INDEX \`idx_print_jobs_manual_resolution_admin\` (\`manual_resolution_by_admin_id\`),
  INDEX \`idx_print_jobs_supersedes\` (\`supersedes_job_id\`),
  CONSTRAINT \`fk_print_jobs_batch\` FOREIGN KEY (\`batch_id\`) REFERENCES \`${STAGING_PRINT_BATCHES}\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT \`fk_print_jobs_order\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT \`fk_print_jobs_printer\` FOREIGN KEY (\`printer_id\`) REFERENCES \`cloud_printers\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT \`fk_print_jobs_created_by_admin\` FOREIGN KEY (\`created_by_admin_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT \`fk_print_jobs_manual_resolution_admin\` FOREIGN KEY (\`manual_resolution_by_admin_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT \`fk_print_jobs_supersedes\` FOREIGN KEY (\`supersedes_job_id\`) REFERENCES \`${STAGING_PRINT_JOBS}\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='bake-mall:0012-cloud-print-jobs:staging:v1'`,
      );

      await queryRunner.query(
        `RENAME TABLE \`${STAGING_PRINT_BATCHES}\` TO \`print_batches\`, \`${STAGING_PRINT_JOBS}\` TO \`print_jobs\``,
      );
    }, [() => releaseMigrationLock(queryRunner)]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    ensurePrintingWritersStopped();
    await acquireMigrationLock(queryRunner);
    await runWithCleanupPreservingError(async () => {
      await queryRunner.query(
        'LOCK TABLES `print_jobs` WRITE, `print_batches` WRITE',
      );
      await runWithCleanupPreservingError(async () => {
        const printJobs = await queryRunner.query(
          'SELECT EXISTS(SELECT 1 FROM `print_jobs` LIMIT 1) AS `has_blocking_data`',
        );
        const printBatches = await queryRunner.query(
          'SELECT EXISTS(SELECT 1 FROM `print_batches` LIMIT 1) AS `has_blocking_data`',
        );
        const blockingTables = [
          ...(hasBlockingData(printJobs) ? ['print_jobs'] : []),
          ...(hasBlockingData(printBatches) ? ['print_batches'] : []),
        ];
        if (blockingTables.length > 0) {
          throw new Error(
            `CloudPrintJobs1718000000011 cannot revert（无法回滚）：打印域表存在数据 (${blockingTables.join(', ')})`,
          );
        }

        await queryRunner.query('DROP TABLE `print_jobs`, `print_batches`');
      }, [() => queryRunner.query('UNLOCK TABLES')]);
    }, [() => releaseMigrationLock(queryRunner)]);
  }
}
