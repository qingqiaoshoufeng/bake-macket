import type { MigrationInterface, QueryRunner } from 'typeorm';

const hasBlockingData = (result: unknown): boolean => {
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('0011 down guard returned an invalid result');
  }
  const row = result[0];
  if (typeof row !== 'object' || row === null) {
    throw new Error('0011 down guard returned an invalid row');
  }
  const value = Number((row as Record<string, unknown>).has_blocking_data);
  if (value !== 0 && value !== 1) {
    throw new Error('0011 down guard returned an invalid flag');
  }
  return value === 1;
};

const PRINTING_MAINTENANCE_ENV = 'BAKE_MALL_MAINTENANCE_MODE';
const PRINTING_WRITERS_STOPPED_ENV = 'BAKE_MALL_PRINTING_WRITERS_STOPPED';
const PRINTING_DOWN_CONFIRMATION =
  '0011 down requires BAKE_MALL_MAINTENANCE_MODE=1 and BAKE_MALL_PRINTING_WRITERS_STOPPED=1（必须明确维护模式并停止所有写入）';

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

/** Adds cloud printers and replay-safe administrator operation claims. */
export class CloudPrinters1718000000010 implements MigrationInterface {
  name = 'CloudPrinters1718000000010';
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`admin_operation_idempotency\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`admin_id\` BIGINT UNSIGNED NOT NULL,
  \`operation\` VARCHAR(64) NOT NULL,
  \`key\` VARCHAR(128) NOT NULL,
  \`request_hash\` CHAR(64) NOT NULL,
  \`status\` ENUM('IN_PROGRESS','COMPLETED','FAILED','UNKNOWN') NOT NULL,
  \`resource_type\` VARCHAR(64) NULL,
  \`resource_id\` VARCHAR(64) NULL,
  \`response_snapshot\` JSON NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE INDEX \`uniq_admin_operation_idempotency_scope\` (\`admin_id\`, \`operation\`, \`key\`),
  INDEX \`idx_admin_operation_idempotency_admin\` (\`admin_id\`),
  CONSTRAINT \`fk_admin_operation_idempotency_admin\` FOREIGN KEY (\`admin_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );

    await queryRunner.query(
      `CREATE TABLE \`cloud_printers\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`serial_number\` VARCHAR(64) NOT NULL,
  \`display_name\` VARCHAR(64) NOT NULL,
  \`status\` ENUM('BINDING','PENDING_VERIFICATION','ACTIVE','UNBINDING','UNBOUND','ERROR') NOT NULL,
  \`binding_stage\` ENUM('NONE','ADD_PRINTER','PRINT_VERIFICATION_CODE','COMPENSATION_DELETE','UNBIND_DELETE','RECONCILIATION') NOT NULL DEFAULT 'NONE',
  \`vendor_relation_state\` ENUM('UNKNOWN','CONFIRMED_BOUND','CONFIRMED_UNBOUND') NOT NULL DEFAULT 'UNKNOWN',
  \`binding_idempotency_key\` VARCHAR(128) NULL,
  \`binding_operation_id\` BIGINT UNSIGNED NULL,
  \`verification_code_hash\` VARCHAR(255) NULL,
  \`verification_expires_at\` DATETIME NULL,
  \`verification_failed_attempts\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`verified_at\` DATETIME NULL,
  \`last_online_status\` ENUM('UNKNOWN','OFFLINE','ONLINE','ABNORMAL') NOT NULL DEFAULT 'UNKNOWN',
  \`last_status_checked_at\` DATETIME NULL,
  \`bound_by_admin_id\` BIGINT UNSIGNED NOT NULL,
  \`last_vendor_error_code\` VARCHAR(64) NULL,
  \`unbound_at\` DATETIME NULL,
  \`version\` INT UNSIGNED NOT NULL DEFAULT 1,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE INDEX \`uniq_cloud_printers_serial_number\` (\`serial_number\`),
  INDEX \`idx_cloud_printers_status\` (\`status\`),
  INDEX \`idx_cloud_printers_bound_by_admin\` (\`bound_by_admin_id\`),
  INDEX \`idx_cloud_printers_binding_operation\` (\`binding_operation_id\`),
  CONSTRAINT \`fk_cloud_printers_bound_by_admin\` FOREIGN KEY (\`bound_by_admin_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT \`fk_cloud_printers_binding_operation\` FOREIGN KEY (\`binding_operation_id\`) REFERENCES \`admin_operation_idempotency\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    ensurePrintingWritersStopped();

    await queryRunner.query(
      'LOCK TABLES `cloud_printers` WRITE, `admin_operation_idempotency` WRITE',
    );
    try {
      const cloudPrinters = await queryRunner.query(
        'SELECT EXISTS(SELECT 1 FROM `cloud_printers` LIMIT 1) AS `has_blocking_data`',
      );
      const adminOperations = await queryRunner.query(
        'SELECT EXISTS(SELECT 1 FROM `admin_operation_idempotency` LIMIT 1) AS `has_blocking_data`',
      );

      const blockingTables = [
        ...(hasBlockingData(cloudPrinters) ? ['cloud_printers'] : []),
        ...(hasBlockingData(adminOperations)
          ? ['admin_operation_idempotency']
          : []),
      ];
      if (blockingTables.length > 0) {
        throw new Error(
          `CloudPrinters1718000000010 cannot revert（无法回滚）：设备域表存在数据 (${blockingTables.join(', ')})`,
        );
      }

      await queryRunner.query('DROP TABLE `cloud_printers`');
      await queryRunner.query('DROP TABLE `admin_operation_idempotency`');
    } finally {
      await queryRunner.query('UNLOCK TABLES');
    }
  }
}
