import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SkuStockVersion1718000000003 implements MigrationInterface {
  name = 'SkuStockVersion1718000000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `skus` ADD `stock_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `stock`',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `skus` DROP COLUMN `stock_version`');
  }
}
