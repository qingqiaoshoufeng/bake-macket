import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds stable source IDs to immutable order item snapshots and conservatively backfills history. */
export class OrderItemSourceIds1718000000007 implements MigrationInterface {
  name = 'OrderItemSourceIds1718000000007';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`order_items\`
  ADD COLUMN \`product_id\` BIGINT UNSIGNED NULL AFTER \`order_id\`,
  ADD COLUMN \`sku_id\` BIGINT UNSIGNED NULL AFTER \`product_id\``);
    await queryRunner.query(
      'CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`)',
    );
    await queryRunner.query(
      'CREATE INDEX `idx_order_items_sku` ON `order_items` (`sku_id`)',
    );
    await queryRunner.query(`UPDATE \`order_items\` item
INNER JOIN (
  SELECT
    source.\`id\` AS \`order_item_id\`,
    MIN(sku.\`product_id\`) AS \`product_id\`,
    MIN(sku.\`id\`) AS \`sku_id\`
  FROM \`order_items\` source
  INNER JOIN \`products\` product
    ON product.\`name\` = source.\`product_name\`
  INNER JOIN \`skus\` sku
    ON sku.\`product_id\` = product.\`id\`
   AND sku.\`name\` = source.\`sku_name\`
   AND CAST(sku.\`attributes\` AS CHAR) = CAST(source.\`sku_attributes\` AS CHAR)
  GROUP BY source.\`id\`
  HAVING COUNT(*) = 1
) matched ON matched.\`order_item_id\` = item.\`id\`
SET item.\`product_id\` = matched.\`product_id\`,
    item.\`sku_id\` = matched.\`sku_id\``);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX `idx_order_items_sku` ON `order_items`',
    );
    await queryRunner.query(
      'DROP INDEX `idx_order_items_product` ON `order_items`',
    );
    await queryRunner.query('ALTER TABLE `order_items` DROP COLUMN `sku_id`');
    await queryRunner.query(
      'ALTER TABLE `order_items` DROP COLUMN `product_id`',
    );
  }
}
