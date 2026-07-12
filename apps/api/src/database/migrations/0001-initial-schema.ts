import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for the Bake Mall API.
 *
 * Mirrors the entities under `../entities` and the domain model in
 * `docs/superpowers/specs/2026-07-12-bake-mall-design.md`. The schema is
 * owned by migrations from this point forward; `synchronize` stays disabled.
 *
 * Conventions:
 *   - charset / collation: `utf8mb4` / `utf8mb4_unicode_ci`.
 *   - timestamps: `DATETIME` columns store UTC values (runtime `timezone: 'Z'`).
 *   - primary keys: `BIGINT UNSIGNED`.
 *   - money: integer cents (`INT UNSIGNED`).
 *   - quantity: positive `INT UNSIGNED` where applicable.
 */
export class InitialSchema1718000000000 implements MigrationInterface {
  name = 'InitialSchema1718000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`users\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`wechat_openid\` VARCHAR(64) NULL,
        \`wechat_unionid\` VARCHAR(64) NULL,
        \`nickname\` VARCHAR(64) NULL,
        \`avatar_url\` VARCHAR(512) NULL,
        \`phone\` VARCHAR(32) NULL,
        \`phone_verified\` TINYINT(1) NOT NULL DEFAULT 0,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uniq_users_phone\` (\`phone\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`addresses\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`recipient\` VARCHAR(64) NOT NULL,
        \`phone\` VARCHAR(32) NOT NULL,
        \`province\` VARCHAR(64) NOT NULL,
        \`city\` VARCHAR(64) NOT NULL,
        \`district\` VARCHAR(64) NOT NULL,
        \`detail\` VARCHAR(256) NOT NULL,
        \`is_default\` TINYINT(1) NOT NULL DEFAULT 0,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_addresses_user\` (\`user_id\`),
        CONSTRAINT \`fk_addresses_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`categories\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(64) NOT NULL,
        \`image_url\` VARCHAR(512) NULL,
        \`sort_order\` INT NOT NULL DEFAULT 0,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`products\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(128) NOT NULL,
        \`summary\` VARCHAR(512) NULL,
        \`category_id\` BIGINT UNSIGNED NOT NULL,
        \`cover_image_url\` VARCHAR(512) NULL,
        \`detail_html\` MEDIUMTEXT NOT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_products_category\` (\`category_id\`),
        CONSTRAINT \`fk_products_category\` FOREIGN KEY (\`category_id\`) REFERENCES \`categories\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`product_images\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`product_id\` BIGINT UNSIGNED NOT NULL,
        \`url\` VARCHAR(512) NOT NULL,
        \`sort_order\` INT NOT NULL DEFAULT 0,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_product_images_product\` (\`product_id\`),
        CONSTRAINT \`fk_product_images_product\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`skus\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`product_id\` BIGINT UNSIGNED NOT NULL,
        \`name\` VARCHAR(128) NOT NULL,
        \`attributes\` JSON NOT NULL,
        \`price_cents\` INT UNSIGNED NOT NULL,
        \`stock\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`image_url\` VARCHAR(512) NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_skus_product\` (\`product_id\`),
        CONSTRAINT \`chk_skus_price_nonneg\` CHECK (\`price_cents\` >= 0),
        CONSTRAINT \`chk_skus_stock_nonneg\` CHECK (\`stock\` >= 0),
        CONSTRAINT \`fk_skus_product\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`cart_items\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`sku_id\` BIGINT UNSIGNED NOT NULL,
        \`quantity\` INT UNSIGNED NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uniq_cart_items_user_sku\` (\`user_id\`, \`sku_id\`),
        INDEX \`idx_cart_items_user\` (\`user_id\`),
        CONSTRAINT \`chk_cart_items_qty_positive\` CHECK (\`quantity\` > 0),
        CONSTRAINT \`fk_cart_items_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_cart_items_sku\` FOREIGN KEY (\`sku_id\`) REFERENCES \`skus\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`banners\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`image_url\` VARCHAR(512) NOT NULL,
        \`title\` VARCHAR(128) NULL,
        \`target_type\` ENUM('NONE','PRODUCT','CATEGORY') NOT NULL DEFAULT 'NONE',
        \`target_id\` BIGINT UNSIGNED NULL,
        \`sort_order\` INT NOT NULL DEFAULT 0,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_banners_active_sort\` (\`is_active\`, \`sort_order\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`orders\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`order_no\` VARCHAR(32) NOT NULL,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`status\` ENUM('NEW','PROCESSING','COMPLETED','CANCELLED') NOT NULL DEFAULT 'NEW',
        \`fulfillment_type\` ENUM('PICKUP','DELIVERY') NOT NULL,
        \`contact_name\` VARCHAR(64) NOT NULL,
        \`contact_phone\` VARCHAR(32) NOT NULL,
        \`pickup_time_text\` VARCHAR(256) NULL,
        \`delivery_address_text\` VARCHAR(512) NULL,
        \`goods_total_cents\` INT UNSIGNED NOT NULL,
        \`remark\` VARCHAR(512) NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uniq_orders_order_no\` (\`order_no\`),
        INDEX \`idx_orders_user\` (\`user_id\`),
        INDEX \`idx_orders_status\` (\`status\`),
        CONSTRAINT \`chk_orders_total_nonneg\` CHECK (\`goods_total_cents\` >= 0),
        CONSTRAINT \`fk_orders_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`order_items\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`order_id\` BIGINT UNSIGNED NOT NULL,
        \`product_name\` VARCHAR(128) NOT NULL,
        \`sku_name\` VARCHAR(128) NOT NULL,
        \`sku_attributes\` JSON NOT NULL,
        \`image_url\` VARCHAR(512) NULL,
        \`unit_price_cents\` INT UNSIGNED NOT NULL,
        \`quantity\` INT UNSIGNED NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_order_items_order\` (\`order_id\`),
        CONSTRAINT \`chk_order_items_unit_price_nonneg\` CHECK (\`unit_price_cents\` >= 0),
        CONSTRAINT \`chk_order_items_qty_positive\` CHECK (\`quantity\` > 0),
        CONSTRAINT \`fk_order_items_order\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`admin_users\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`username\` VARCHAR(64) NOT NULL,
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uniq_admin_users_username\` (\`username\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`audit_logs\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`admin_user_id\` BIGINT UNSIGNED NOT NULL,
        \`target_entity\` VARCHAR(64) NOT NULL,
        \`target_id\` VARCHAR(64) NOT NULL,
        \`action\` VARCHAR(64) NOT NULL,
        \`change_summary\` JSON NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_audit_logs_admin\` (\`admin_user_id\`),
        INDEX \`idx_audit_logs_target\` (\`target_entity\`, \`target_id\`),
        CONSTRAINT \`fk_audit_logs_admin\` FOREIGN KEY (\`admin_user_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await queryRunner.query(`CREATE TABLE \`idempotency_records\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`key\` VARCHAR(128) NOT NULL,
        \`order_id\` BIGINT UNSIGNED NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uniq_idempotency_user_key\` (\`user_id\`, \`key\`),
        INDEX \`idx_idempotency_user\` (\`user_id\`),
        CONSTRAINT \`fk_idempotency_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_idempotency_order\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `idempotency_records`');
    await queryRunner.query('DROP TABLE IF EXISTS `audit_logs`');
    await queryRunner.query('DROP TABLE IF EXISTS `admin_users`');
    await queryRunner.query('DROP TABLE IF EXISTS `order_items`');
    await queryRunner.query('DROP TABLE IF EXISTS `orders`');
    await queryRunner.query('DROP TABLE IF EXISTS `banners`');
    await queryRunner.query('DROP TABLE IF EXISTS `cart_items`');
    await queryRunner.query('DROP TABLE IF EXISTS `skus`');
    await queryRunner.query('DROP TABLE IF EXISTS `product_images`');
    await queryRunner.query('DROP TABLE IF EXISTS `products`');
    await queryRunner.query('DROP TABLE IF EXISTS `categories`');
    await queryRunner.query('DROP TABLE IF EXISTS `addresses`');
    await queryRunner.query('DROP TABLE IF EXISTS `users`');
  }

  private createUsersTable(): string {
    return `CREATE TABLE \`users\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`wechat_openid\` VARCHAR(64) NULL,
        \`wechat_unionid\` VARCHAR(64) NULL,
        \`nickname\` VARCHAR(64) NULL,
        \`avatar_url\` VARCHAR(512) NULL,
        \`phone\` VARCHAR(32) NULL,
        \`phone_verified\` TINYINT(1) NOT NULL DEFAULT 0,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uniq_users_phone\` (\`phone\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createAddressesTable(): string {
    return `CREATE TABLE \`addresses\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`recipient\` VARCHAR(64) NOT NULL,
        \`phone\` VARCHAR(32) NOT NULL,
        \`province\` VARCHAR(64) NOT NULL,
        \`city\` VARCHAR(64) NOT NULL,
        \`district\` VARCHAR(64) NOT NULL,
        \`detail\` VARCHAR(256) NOT NULL,
        \`is_default\` TINYINT(1) NOT NULL DEFAULT 0,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_addresses_user\` (\`user_id\`),
        CONSTRAINT \`fk_addresses_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createCategoriesTable(): string {
    return `CREATE TABLE \`categories\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(64) NOT NULL,
        \`image_url\` VARCHAR(512) NULL,
        \`sort_order\` INT NOT NULL DEFAULT 0,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createProductsTable(): string {
    return `CREATE TABLE \`products\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` VARCHAR(128) NOT NULL,
        \`summary\` VARCHAR(512) NULL,
        \`category_id\` BIGINT UNSIGNED NOT NULL,
        \`cover_image_url\` VARCHAR(512) NULL,
        \`detail_html\` MEDIUMTEXT NOT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_products_category\` (\`category_id\`),
        CONSTRAINT \`fk_products_category\` FOREIGN KEY (\`category_id\`) REFERENCES \`categories\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createProductImagesTable(): string {
    return `CREATE TABLE \`product_images\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`product_id\` BIGINT UNSIGNED NOT NULL,
        \`url\` VARCHAR(512) NOT NULL,
        \`sort_order\` INT NOT NULL DEFAULT 0,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_product_images_product\` (\`product_id\`),
        CONSTRAINT \`fk_product_images_product\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createSkusTable(): string {
    return `CREATE TABLE \`skus\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`product_id\` BIGINT UNSIGNED NOT NULL,
        \`name\` VARCHAR(128) NOT NULL,
        \`attributes\` JSON NOT NULL,
        \`price_cents\` INT UNSIGNED NOT NULL,
        \`stock\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`image_url\` VARCHAR(512) NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_skus_product\` (\`product_id\`),
        CONSTRAINT \`chk_skus_price_nonneg\` CHECK (\`price_cents\` >= 0),
        CONSTRAINT \`chk_skus_stock_nonneg\` CHECK (\`stock\` >= 0),
        CONSTRAINT \`fk_skus_product\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createCartItemsTable(): string {
    return `CREATE TABLE \`cart_items\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`sku_id\` BIGINT UNSIGNED NOT NULL,
        \`quantity\` INT UNSIGNED NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uniq_cart_items_user_sku\` (\`user_id\`, \`sku_id\`),
        INDEX \`idx_cart_items_user\` (\`user_id\`),
        CONSTRAINT \`chk_cart_items_qty_positive\` CHECK (\`quantity\` > 0),
        CONSTRAINT \`fk_cart_items_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_cart_items_sku\` FOREIGN KEY (\`sku_id\`) REFERENCES \`skus\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createBannersTable(): string {
    return `CREATE TABLE \`banners\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`image_url\` VARCHAR(512) NOT NULL,
        \`title\` VARCHAR(128) NULL,
        \`target_type\` ENUM('NONE','PRODUCT','CATEGORY') NOT NULL DEFAULT 'NONE',
        \`target_id\` BIGINT UNSIGNED NULL,
        \`sort_order\` INT NOT NULL DEFAULT 0,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_banners_active_sort\` (\`is_active\`, \`sort_order\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createOrdersTable(): string {
    return `CREATE TABLE \`orders\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`order_no\` VARCHAR(32) NOT NULL,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`status\` ENUM('NEW','PROCESSING','COMPLETED','CANCELLED') NOT NULL DEFAULT 'NEW',
        \`fulfillment_type\` ENUM('PICKUP','DELIVERY') NOT NULL,
        \`contact_name\` VARCHAR(64) NOT NULL,
        \`contact_phone\` VARCHAR(32) NOT NULL,
        \`pickup_time_text\` VARCHAR(256) NULL,
        \`delivery_address_text\` VARCHAR(512) NULL,
        \`goods_total_cents\` INT UNSIGNED NOT NULL,
        \`remark\` VARCHAR(512) NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uniq_orders_order_no\` (\`order_no\`),
        INDEX \`idx_orders_user\` (\`user_id\`),
        INDEX \`idx_orders_status\` (\`status\`),
        CONSTRAINT \`chk_orders_total_nonneg\` CHECK (\`goods_total_cents\` >= 0),
        CONSTRAINT \`fk_orders_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createOrderItemsTable(): string {
    return `CREATE TABLE \`order_items\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`order_id\` BIGINT UNSIGNED NOT NULL,
        \`product_name\` VARCHAR(128) NOT NULL,
        \`sku_name\` VARCHAR(128) NOT NULL,
        \`sku_attributes\` JSON NOT NULL,
        \`image_url\` VARCHAR(512) NULL,
        \`unit_price_cents\` INT UNSIGNED NOT NULL,
        \`quantity\` INT UNSIGNED NOT NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_order_items_order\` (\`order_id\`),
        CONSTRAINT \`chk_order_items_unit_price_nonneg\` CHECK (\`unit_price_cents\` >= 0),
        CONSTRAINT \`chk_order_items_qty_positive\` CHECK (\`quantity\` > 0),
        CONSTRAINT \`fk_order_items_order\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createAdminUsersTable(): string {
    return `CREATE TABLE \`admin_users\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`username\` VARCHAR(64) NOT NULL,
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uniq_admin_users_username\` (\`username\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createAuditLogsTable(): string {
    return `CREATE TABLE \`audit_logs\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`admin_user_id\` BIGINT UNSIGNED NOT NULL,
        \`target_entity\` VARCHAR(64) NOT NULL,
        \`target_id\` VARCHAR(64) NOT NULL,
        \`action\` VARCHAR(64) NOT NULL,
        \`change_summary\` JSON NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        INDEX \`idx_audit_logs_admin\` (\`admin_user_id\`),
        INDEX \`idx_audit_logs_target\` (\`target_entity\`, \`target_id\`),
        CONSTRAINT \`fk_audit_logs_admin\` FOREIGN KEY (\`admin_user_id\`) REFERENCES \`admin_users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }

  private createIdempotencyRecordsTable(): string {
    return `CREATE TABLE \`idempotency_records\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`user_id\` BIGINT UNSIGNED NOT NULL,
        \`key\` VARCHAR(128) NOT NULL,
        \`order_id\` BIGINT UNSIGNED NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`uniq_idempotency_user_key\` (\`user_id\`, \`key\`),
        INDEX \`idx_idempotency_user\` (\`user_id\`),
        CONSTRAINT \`fk_idempotency_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`fk_idempotency_order\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  }
}
