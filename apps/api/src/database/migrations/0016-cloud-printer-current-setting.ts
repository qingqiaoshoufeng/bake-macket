import type { MigrationInterface, QueryRunner } from 'typeorm';

const PRINTING_MAINTENANCE_ENV = 'BAKE_MALL_MAINTENANCE_MODE';
const PRINTING_WRITERS_STOPPED_ENV = 'BAKE_MALL_PRINTING_WRITERS_STOPPED';
const PRINTING_DOWN_CONFIRMATION =
  '0016 down requires BAKE_MALL_MAINTENANCE_MODE=1 and BAKE_MALL_PRINTING_WRITERS_STOPPED=1（必须明确维护模式并停止所有写入）';

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

const hasCurrentPrinter = (result: unknown): boolean => {
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('0016 down current guard returned an invalid result');
  }
  const value = Number(
    (result[0] as Record<string, unknown> | undefined)?.has_current,
  );
  if (value !== 0 && value !== 1) {
    throw new Error('0016 down current guard returned an invalid flag');
  }
  return value === 1;
};

/** Adds the singleton store-level current cloud printer setting. */
export class CloudPrinterCurrentSetting1718000000014 implements MigrationInterface {
  name = 'CloudPrinterCurrentSetting1718000000014';
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`cloud_printer_store_settings\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`scope_key\` VARCHAR(32) NOT NULL,
  \`current_printer_id\` BIGINT UNSIGNED NULL,
  \`revision\` INT UNSIGNED NOT NULL DEFAULT 1,
  \`updated_by_admin_id\` BIGINT UNSIGNED NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE INDEX \`uniq_cloud_printer_store_settings_scope_key\` (\`scope_key\`),
  INDEX \`idx_cloud_printer_store_settings_current_printer\` (\`current_printer_id\`),
  INDEX \`idx_cloud_printer_store_settings_updated_by_admin\` (\`updated_by_admin_id\`),
  CONSTRAINT \`fk_cloud_printer_store_settings_current_printer\` FOREIGN KEY (\`current_printer_id\`) REFERENCES \`cloud_printers\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT \`fk_cloud_printer_store_settings_updated_by_admin\` FOREIGN KEY (\`updated_by_admin_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    );
    await queryRunner.query(
      "INSERT INTO `cloud_printer_store_settings` (`scope_key`, `current_printer_id`, `revision`, `updated_by_admin_id`) VALUES ('STORE', NULL, 1, NULL)",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    ensurePrintingWritersStopped();
    await queryRunner.query(
      'LOCK TABLES `cloud_printer_store_settings` WRITE',
    );
    try {
      const result = await queryRunner.query(
        'SELECT EXISTS(SELECT 1 FROM `cloud_printer_store_settings` WHERE `current_printer_id` IS NOT NULL LIMIT 1) AS `has_current`',
      );
      if (hasCurrentPrinter(result)) {
        throw new Error(
          'CloudPrinterCurrentSetting1718000000014 down refused: 当前打印机非空',
        );
      }
      await queryRunner.query('DROP TABLE `cloud_printer_store_settings`');
    } finally {
      await queryRunner.query('UNLOCK TABLES');
    }
  }
}
