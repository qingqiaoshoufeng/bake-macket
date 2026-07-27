import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds membership, permanent credit bookkeeping, and immutable order pricing. */
export class MembershipAndOrderPricing1718000000004 implements MigrationInterface {
  name = 'MembershipAndOrderPricing1718000000004';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`membership_levels\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`code\` VARCHAR(64) NOT NULL,
      \`name\` VARCHAR(128) NOT NULL,
      \`subtitle\` VARCHAR(256) NULL,
      \`description\` TEXT NULL,
      \`rank\` INT UNSIGNED NOT NULL,
      \`price_cents\` INT UNSIGNED NOT NULL,
      \`grant_credit_cents\` INT UNSIGNED NOT NULL,
      \`discount_basis_points\` INT UNSIGNED NOT NULL,
      \`valid_days\` INT UNSIGNED NOT NULL,
      \`benefits\` JSON NOT NULL,
      \`theme\` ENUM('PEARL','CHAMPAGNE','JADE','OBSIDIAN') NOT NULL,
      \`badge_text\` VARCHAR(32) NOT NULL,
      \`sort_order\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 0,
      \`version\` INT UNSIGNED NOT NULL DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`uniq_membership_levels_code\` (\`code\`),
      UNIQUE INDEX \`uniq_membership_levels_rank\` (\`rank\`),
      INDEX \`idx_membership_levels_active_sort\` (\`is_active\`, \`sort_order\`),
      CONSTRAINT \`chk_membership_levels_rank_positive\` CHECK (\`rank\` > 0),
      CONSTRAINT \`chk_membership_levels_discount_range\` CHECK (\`discount_basis_points\` BETWEEN 1000 AND 10000),
      CONSTRAINT \`chk_membership_levels_valid_days_range\` CHECK (\`valid_days\` BETWEEN 1 AND 3650)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await queryRunner.query(`CREATE TABLE \`membership_purchase_orders\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`purchase_no\` VARCHAR(32) NOT NULL,
      \`user_id\` BIGINT UNSIGNED NOT NULL,
      \`membership_level_id\` BIGINT UNSIGNED NOT NULL,
      \`level_code\` VARCHAR(64) NOT NULL,
      \`level_name\` VARCHAR(128) NOT NULL,
      \`level_rank\` INT UNSIGNED NOT NULL,
      \`price_cents\` INT UNSIGNED NOT NULL,
      \`grant_credit_cents\` INT UNSIGNED NOT NULL,
      \`discount_basis_points\` INT UNSIGNED NOT NULL,
      \`valid_days\` INT UNSIGNED NOT NULL,
      \`benefits\` JSON NOT NULL,
      \`theme\` ENUM('PEARL','CHAMPAGNE','JADE','OBSIDIAN') NOT NULL,
      \`badge_text\` VARCHAR(32) NOT NULL,
      \`status\` ENUM('PENDING','FULFILLED','VOIDED') NOT NULL DEFAULT 'PENDING',
      \`payment_status\` ENUM('PENDING','SUCCEEDED','REVERSED') NOT NULL DEFAULT 'PENDING',
      \`payment_channel\` ENUM('SIMULATED') NOT NULL DEFAULT 'SIMULATED',
      \`idempotency_key\` VARCHAR(128) NOT NULL,
      \`request_hash\` CHAR(64) NOT NULL,
      \`paid_at\` DATETIME NULL,
      \`voided_at\` DATETIME NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`uniq_membership_purchase_orders_no\` (\`purchase_no\`),
      UNIQUE INDEX \`uniq_membership_purchase_orders_user_key\` (\`user_id\`, \`idempotency_key\`),
      INDEX \`idx_membership_purchase_orders_user_created\` (\`user_id\`, \`created_at\`),
      INDEX \`idx_membership_purchase_orders_level\` (\`membership_level_id\`),
      CONSTRAINT \`chk_membership_purchase_level_rank_positive\` CHECK (\`level_rank\` > 0),
      CONSTRAINT \`chk_membership_purchase_discount_range\` CHECK (\`discount_basis_points\` BETWEEN 1000 AND 10000),
      CONSTRAINT \`chk_membership_purchase_valid_days_range\` CHECK (\`valid_days\` BETWEEN 1 AND 3650),
      CONSTRAINT \`fk_membership_purchase_orders_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_membership_purchase_orders_level\` FOREIGN KEY (\`membership_level_id\`) REFERENCES \`membership_levels\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await queryRunner.query(`CREATE TABLE \`user_memberships\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`user_id\` BIGINT UNSIGNED NOT NULL,
      \`purchase_order_id\` BIGINT UNSIGNED NOT NULL,
      \`membership_level_id\` BIGINT UNSIGNED NOT NULL,
      \`level_code\` VARCHAR(64) NOT NULL,
      \`level_name\` VARCHAR(128) NOT NULL,
      \`level_rank\` INT UNSIGNED NOT NULL,
      \`discount_basis_points\` INT UNSIGNED NOT NULL,
      \`benefits\` JSON NOT NULL,
      \`theme\` ENUM('PEARL','CHAMPAGNE','JADE','OBSIDIAN') NOT NULL,
      \`badge_text\` VARCHAR(32) NOT NULL,
      \`starts_at\` DATETIME NOT NULL,
      \`ends_at\` DATETIME NOT NULL,
      \`previous_membership_id\` BIGINT UNSIGNED NULL,
      \`status\` ENUM('ACTIVE','REPLACED','VOIDED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`uniq_user_memberships_purchase\` (\`purchase_order_id\`),
      INDEX \`idx_user_memberships_user_status\` (\`user_id\`, \`status\`),
      INDEX \`idx_user_memberships_level\` (\`membership_level_id\`),
      CONSTRAINT \`chk_user_memberships_level_rank_positive\` CHECK (\`level_rank\` > 0),
      CONSTRAINT \`chk_user_memberships_discount_range\` CHECK (\`discount_basis_points\` BETWEEN 1000 AND 10000),
      CONSTRAINT \`chk_user_memberships_period\` CHECK (\`ends_at\` > \`starts_at\`),
      CONSTRAINT \`fk_user_memberships_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_user_memberships_purchase\` FOREIGN KEY (\`purchase_order_id\`) REFERENCES \`membership_purchase_orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_user_memberships_level\` FOREIGN KEY (\`membership_level_id\`) REFERENCES \`membership_levels\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_user_memberships_previous\` FOREIGN KEY (\`previous_membership_id\`) REFERENCES \`user_memberships\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await queryRunner.query(`CREATE TABLE \`member_accounts\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`user_id\` BIGINT UNSIGNED NOT NULL,
      \`active_membership_id\` BIGINT UNSIGNED NULL,
      \`available_credit_cents\` INT UNSIGNED NOT NULL DEFAULT 0,
      \`version\` INT UNSIGNED NOT NULL DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`uniq_member_accounts_user\` (\`user_id\`),
      CONSTRAINT \`fk_member_accounts_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_member_accounts_active_membership\` FOREIGN KEY (\`active_membership_id\`) REFERENCES \`user_memberships\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await queryRunner.query(`CREATE TABLE \`member_credit_grants\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`account_id\` BIGINT UNSIGNED NOT NULL,
      \`purchase_order_id\` BIGINT UNSIGNED NOT NULL,
      \`granted_cents\` INT UNSIGNED NOT NULL,
      \`remaining_cents\` INT UNSIGNED NOT NULL,
      \`status\` ENUM('ACTIVE','EXHAUSTED','REVERSED') NOT NULL DEFAULT 'ACTIVE',
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`uniq_member_credit_grants_purchase\` (\`purchase_order_id\`),
      INDEX \`idx_member_credit_grants_account_created\` (\`account_id\`, \`created_at\`),
      CONSTRAINT \`chk_member_credit_grants_remaining_range\` CHECK (\`remaining_cents\` BETWEEN 0 AND \`granted_cents\`),
      CONSTRAINT \`fk_member_credit_grants_account\` FOREIGN KEY (\`account_id\`) REFERENCES \`member_accounts\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_member_credit_grants_purchase\` FOREIGN KEY (\`purchase_order_id\`) REFERENCES \`membership_purchase_orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await queryRunner.query(`CREATE TABLE \`member_credit_entries\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`account_id\` BIGINT UNSIGNED NOT NULL,
      \`direction\` ENUM('CREDIT','DEBIT') NOT NULL,
      \`type\` ENUM('MEMBERSHIP_PURCHASE_GRANT','PRODUCT_ORDER_DEBIT','PRODUCT_ORDER_CANCEL_REVERSAL','MEMBERSHIP_PURCHASE_VOID_REVERSAL') NOT NULL,
      \`amount_cents\` INT UNSIGNED NOT NULL,
      \`balance_after_cents\` INT UNSIGNED NOT NULL,
      \`reference_type\` VARCHAR(64) NOT NULL,
      \`reference_id\` VARCHAR(64) NOT NULL,
      \`operation_key\` VARCHAR(128) NOT NULL,
      \`reversal_of_entry_id\` BIGINT UNSIGNED NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE INDEX \`uniq_member_credit_entries_operation\` (\`operation_key\`),
      INDEX \`idx_member_credit_entries_account_created\` (\`account_id\`, \`created_at\`),
      CONSTRAINT \`chk_member_credit_entries_amount_positive\` CHECK (\`amount_cents\` > 0),
      CONSTRAINT \`fk_member_credit_entries_account\` FOREIGN KEY (\`account_id\`) REFERENCES \`member_accounts\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_member_credit_entries_reversal\` FOREIGN KEY (\`reversal_of_entry_id\`) REFERENCES \`member_credit_entries\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await queryRunner.query(`CREATE TABLE \`member_credit_allocations\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`credit_entry_id\` BIGINT UNSIGNED NOT NULL,
      \`grant_id\` BIGINT UNSIGNED NOT NULL,
      \`amount_cents\` INT UNSIGNED NOT NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      INDEX \`idx_member_credit_allocations_entry\` (\`credit_entry_id\`),
      INDEX \`idx_member_credit_allocations_grant\` (\`grant_id\`),
      CONSTRAINT \`chk_member_credit_allocations_amount_positive\` CHECK (\`amount_cents\` > 0),
      CONSTRAINT \`fk_member_credit_allocations_entry\` FOREIGN KEY (\`credit_entry_id\`) REFERENCES \`member_credit_entries\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT \`fk_member_credit_allocations_grant\` FOREIGN KEY (\`grant_id\`) REFERENCES \`member_credit_grants\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await queryRunner.query(
      'ALTER TABLE `orders` ADD `membership_discount_cents` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `goods_total_cents`, ADD `credit_applied_cents` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `membership_discount_cents`, ADD `payable_total_cents` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `credit_applied_cents`, ADD `membership_id` BIGINT UNSIGNED NULL AFTER `payable_total_cents`, ADD `membership_code` VARCHAR(64) NULL AFTER `membership_id`, ADD `membership_name` VARCHAR(128) NULL AFTER `membership_code`, ADD `membership_discount_basis_points` INT UNSIGNED NULL AFTER `membership_name`, ADD `pricing_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `membership_discount_basis_points`',
    );
    await queryRunner.query(
      'ALTER TABLE `orders` ADD CONSTRAINT `fk_orders_membership` FOREIGN KEY (`membership_id`) REFERENCES `user_memberships` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    await queryRunner.query(
      'UPDATE `orders` SET `payable_total_cents` = `goods_total_cents`',
    );
    await queryRunner.query(
      'ALTER TABLE `orders` ADD CONSTRAINT `chk_orders_pricing_totals` CHECK (`payable_total_cents` = `goods_total_cents` - `membership_discount_cents` - `credit_applied_cents`)',
    );
    await queryRunner.query(
      'ALTER TABLE `order_items` ADD `line_goods_total_cents` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `quantity`, ADD `line_membership_discount_cents` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `line_goods_total_cents`, ADD `line_payable_cents` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `line_membership_discount_cents`',
    );
    await queryRunner.query(
      'UPDATE `order_items` SET `line_goods_total_cents` = `unit_price_cents` * `quantity`, `line_payable_cents` = `unit_price_cents` * `quantity`',
    );

    await queryRunner.query(
      "ALTER TABLE `idempotency_records` ADD `operation` VARCHAR(64) NOT NULL DEFAULT 'PRODUCT_ORDER_CREATE' AFTER `user_id`, ADD `request_hash` CHAR(64) NULL AFTER `key`, ADD `status` ENUM('IN_PROGRESS','COMPLETED','FAILED') NOT NULL DEFAULT 'COMPLETED' AFTER `request_hash`, ADD `resource_type` VARCHAR(64) NULL AFTER `status`, ADD `resource_id` VARCHAR(64) NULL AFTER `resource_type`, ADD `response_snapshot` JSON NULL AFTER `resource_id`, ADD `expires_at` DATETIME NULL AFTER `order_id`, ADD `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`",
    );
    await queryRunner.query(
      "UPDATE `idempotency_records` SET `resource_type` = 'ORDER', `resource_id` = CAST(`order_id` AS CHAR)",
    );
    await queryRunner.query(
      'DROP INDEX `uniq_idempotency_user_key` ON `idempotency_records`',
    );
    await queryRunner.query(
      'ALTER TABLE `idempotency_records` ADD UNIQUE INDEX `uniq_idempotency_user_operation_key` (`user_id`, `operation`, `key`)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `idempotency_records` DROP INDEX `uniq_idempotency_user_operation_key`',
    );
    await queryRunner.query(
      "DELETE FROM `idempotency_records` WHERE `operation` <> 'PRODUCT_ORDER_CREATE'",
    );
    await queryRunner.query(
      'ALTER TABLE `idempotency_records` DROP COLUMN `updated_at`, DROP COLUMN `expires_at`, DROP COLUMN `response_snapshot`, DROP COLUMN `resource_id`, DROP COLUMN `resource_type`, DROP COLUMN `status`, DROP COLUMN `request_hash`, DROP COLUMN `operation`',
    );
    await queryRunner.query(
      'ALTER TABLE `idempotency_records` ADD UNIQUE INDEX `uniq_idempotency_user_key` (`user_id`, `key`)',
    );
    await queryRunner.query(
      'ALTER TABLE `order_items` DROP COLUMN `line_payable_cents`, DROP COLUMN `line_membership_discount_cents`, DROP COLUMN `line_goods_total_cents`',
    );
    await queryRunner.query(
      'ALTER TABLE `orders` DROP CONSTRAINT `fk_orders_membership`, DROP CONSTRAINT `chk_orders_pricing_totals`, DROP COLUMN `pricing_version`, DROP COLUMN `membership_discount_basis_points`, DROP COLUMN `membership_name`, DROP COLUMN `membership_code`, DROP COLUMN `membership_id`, DROP COLUMN `payable_total_cents`, DROP COLUMN `credit_applied_cents`, DROP COLUMN `membership_discount_cents`',
    );
    await queryRunner.query('DROP TABLE IF EXISTS `member_credit_allocations`');
    await queryRunner.query('DROP TABLE IF EXISTS `member_credit_entries`');
    await queryRunner.query('DROP TABLE IF EXISTS `member_credit_grants`');
    await queryRunner.query('DROP TABLE IF EXISTS `member_accounts`');
    await queryRunner.query('DROP TABLE IF EXISTS `user_memberships`');
    await queryRunner.query(
      'DROP TABLE IF EXISTS `membership_purchase_orders`',
    );
    await queryRunner.query('DROP TABLE IF EXISTS `membership_levels`');
  }
}
