import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds explicit merchandising order for the public catalog. */
export class ProductSortOrder1718000000001 implements MigrationInterface {
  name = 'ProductSortOrder1718000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `products` ADD `sort_order` INT NOT NULL DEFAULT 0 AFTER `detail_html`',
    );
    await queryRunner.query(
      'CREATE INDEX `idx_products_active_sort` ON `products` (`is_active`, `sort_order`, `created_at`)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX `idx_products_active_sort` ON `products`',
    );
    await queryRunner.query('ALTER TABLE `products` DROP COLUMN `sort_order`');
  }
}
