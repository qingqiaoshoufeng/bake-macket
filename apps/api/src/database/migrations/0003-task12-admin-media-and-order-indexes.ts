import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds managed-media object keys and indexes for Task 12 admin queries. */
export class Task12AdminMediaAndOrderIndexes1718000000002
  implements MigrationInterface
{
  name = 'Task12AdminMediaAndOrderIndexes1718000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `products` ADD `cover_image_object_key` VARCHAR(512) NULL AFTER `cover_image_url`',
    );
    await queryRunner.query(
      'ALTER TABLE `product_images` ADD `object_key` VARCHAR(512) NULL AFTER `url`',
    );
    await queryRunner.query(
      'ALTER TABLE `skus` ADD `image_object_key` VARCHAR(512) NULL AFTER `image_url`',
    );
    await queryRunner.query(
      'ALTER TABLE `banners` ADD `image_object_key` VARCHAR(512) NULL AFTER `image_url`',
    );
    await queryRunner.query(
      'CREATE INDEX `idx_orders_admin_created` ON `orders` (`created_at`, `id`)',
    );
    await queryRunner.query(
      'CREATE INDEX `idx_orders_admin_fulfillment_created` ON `orders` (`fulfillment_type`, `created_at`, `id`)',
    );
    await queryRunner.query(
      'CREATE INDEX `idx_orders_admin_status_fulfillment_created` ON `orders` (`status`, `fulfillment_type`, `created_at`, `id`)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX `idx_orders_admin_status_fulfillment_created` ON `orders`',
    );
    await queryRunner.query(
      'DROP INDEX `idx_orders_admin_fulfillment_created` ON `orders`',
    );
    await queryRunner.query(
      'DROP INDEX `idx_orders_admin_created` ON `orders`',
    );
    await queryRunner.query(
      'ALTER TABLE `banners` DROP COLUMN `image_object_key`',
    );
    await queryRunner.query(
      'ALTER TABLE `skus` DROP COLUMN `image_object_key`',
    );
    await queryRunner.query(
      'ALTER TABLE `product_images` DROP COLUMN `object_key`',
    );
    await queryRunner.query(
      'ALTER TABLE `products` DROP COLUMN `cover_image_object_key`',
    );
  }
}
