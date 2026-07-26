import { describe, expect, it, vi } from 'vitest';

import { MembershipAndOrderPricing1718000000004 } from './0005-membership-and-order-pricing.js';

const MEMBERSHIP_TABLES = [
  'membership_levels',
  'member_accounts',
  'membership_purchase_orders',
  'user_memberships',
  'member_credit_grants',
  'member_credit_entries',
  'member_credit_allocations',
] as const;

describe('MembershipAndOrderPricing migration', () => {
  it('creates the seven membership tables with project schema conventions', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const migration = new MembershipAndOrderPricing1718000000004();

    await migration.up({ query } as never);

    const statements = query.mock.calls.map(([sql]) => String(sql));
    for (const table of MEMBERSHIP_TABLES) {
      const createSql = statements.find((sql) =>
        sql.startsWith(`CREATE TABLE \`${table}\``),
      );
      expect(createSql, `missing CREATE TABLE for ${table}`).toBeDefined();
      expect(createSql).toContain(
        '`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT',
      );
      expect(createSql).toContain(
        'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
      );
    }

    expect(statements.join('\n')).toContain('INT UNSIGNED');
    expect(statements.join('\n')).toContain('DATETIME');
    expect(statements.join('\n')).toContain('CHECK');
  });

  it('adds immutable pricing snapshots without changing existing order values', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const migration = new MembershipAndOrderPricing1718000000004();

    await migration.up({ query } as never);

    const statements = query.mock.calls.map(([statement]) => String(statement));
    const sql = statements.join('\n');
    expect(sql).toContain('ALTER TABLE `orders`');
    expect(sql).toContain('`membership_discount_cents` INT UNSIGNED');
    expect(sql).toContain('`credit_applied_cents` INT UNSIGNED');
    expect(sql).toContain('`payable_total_cents` INT UNSIGNED');
    expect(sql).toContain('`membership_id` BIGINT UNSIGNED NULL');
    expect(sql).toContain('`membership_code` VARCHAR(64) NULL');
    expect(sql).toContain('`membership_name` VARCHAR(128) NULL');
    expect(sql).toContain(
      '`membership_discount_basis_points` INT UNSIGNED NULL',
    );
    expect(sql).toContain('`pricing_version` INT UNSIGNED');
    expect(sql).toContain(
      'CONSTRAINT `fk_orders_membership` FOREIGN KEY (`membership_id`) REFERENCES `user_memberships` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    const updateOrders = statements.findIndex((statement) =>
      statement.includes(
        'UPDATE `orders` SET `payable_total_cents` = `goods_total_cents`',
      ),
    );
    const addPricingInvariant = statements.findIndex((statement) =>
      statement.includes('ADD CONSTRAINT `chk_orders_pricing_totals`'),
    );
    expect(updateOrders).toBeGreaterThanOrEqual(0);
    expect(addPricingInvariant).toBeGreaterThan(updateOrders);
    expect(sql).toContain(
      '`payable_total_cents` = `goods_total_cents` - `membership_discount_cents` - `credit_applied_cents`',
    );

    expect(sql).toContain('ALTER TABLE `order_items`');
    expect(sql).toContain('`line_goods_total_cents` INT UNSIGNED');
    expect(sql).toContain('`line_membership_discount_cents` INT UNSIGNED');
    expect(sql).toContain('`line_payable_cents` INT UNSIGNED');
    expect(sql).toContain('UPDATE `order_items`');
  });

  it('upgrades legacy idempotency rows before replacing the unique key', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const migration = new MembershipAndOrderPricing1718000000004();

    await migration.up({ query } as never);

    const statements = query.mock.calls.map(([sql]) => String(sql));
    const upgradeSql = statements.join('\n');
    expect(upgradeSql).toContain(
      "`operation` VARCHAR(64) NOT NULL DEFAULT 'PRODUCT_ORDER_CREATE'",
    );
    expect(upgradeSql).toContain('`request_hash` CHAR(64) NULL');
    expect(upgradeSql).toContain(
      "`status` ENUM('IN_PROGRESS','COMPLETED','FAILED') NOT NULL DEFAULT 'COMPLETED'",
    );
    expect(upgradeSql).toContain('`resource_type` VARCHAR(64) NULL');
    expect(upgradeSql).toContain('`resource_id` VARCHAR(64) NULL');
    expect(upgradeSql).toContain('`response_snapshot` JSON NULL');
    expect(upgradeSql).toContain('`expires_at` DATETIME NULL');
    expect(upgradeSql).toContain(
      "UPDATE `idempotency_records` SET `resource_type` = 'ORDER', `resource_id` = CAST(`order_id` AS CHAR)",
    );

    const dropIndex = statements.findIndex((sql) =>
      sql.includes('DROP INDEX `uniq_idempotency_user_key`'),
    );
    const addIndex = statements.findIndex((sql) =>
      sql.includes(
        'UNIQUE INDEX `uniq_idempotency_user_operation_key` (`user_id`, `operation`, `key`)',
      ),
    );
    expect(dropIndex).toBeGreaterThanOrEqual(0);
    expect(addIndex).toBeGreaterThan(dropIndex);
  });

  it('drops membership and pricing schema in dependency-safe order', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const migration = new MembershipAndOrderPricing1718000000004();

    await migration.down({ query } as never);

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toContain(
      'DROP INDEX `uniq_idempotency_user_operation_key`',
    );
    const deleteUnsupportedOperations = statements.findIndex((statement) =>
      statement.includes(
        "DELETE FROM `idempotency_records` WHERE `operation` <> 'PRODUCT_ORDER_CREATE'",
      ),
    );
    const dropOperationColumn = statements.findIndex(
      (statement) =>
        statement.includes('DROP COLUMN `operation`') &&
        statement.includes('ALTER TABLE `idempotency_records`'),
    );
    const restoreLegacyUniqueIndex = statements.findIndex((statement) =>
      statement.includes(
        'ADD UNIQUE INDEX `uniq_idempotency_user_key` (`user_id`, `key`)',
      ),
    );
    expect(deleteUnsupportedOperations).toBeGreaterThan(0);
    expect(dropOperationColumn).toBeGreaterThan(deleteUnsupportedOperations);
    expect(restoreLegacyUniqueIndex).toBeGreaterThan(dropOperationColumn);
    expect(statements.join('\n')).toContain(
      'DROP TABLE IF EXISTS `member_credit_allocations`',
    );
    expect(statements.join('\n')).toContain(
      'DROP TABLE IF EXISTS `membership_levels`',
    );
    expect(
      statements.filter((statement) =>
        statement.includes('ADD UNIQUE INDEX `uniq_idempotency_user_key`'),
      ),
    ).toHaveLength(1);

    const dropOrdersMembershipForeignKey = statements.findIndex((statement) =>
      statement.includes('DROP CONSTRAINT `fk_orders_membership`'),
    );
    const dropUserMemberships = statements.findIndex((statement) =>
      statement.includes('DROP TABLE IF EXISTS `user_memberships`'),
    );
    expect(dropOrdersMembershipForeignKey).toBeGreaterThanOrEqual(0);
    expect(dropUserMemberships).toBeGreaterThan(dropOrdersMembershipForeignKey);
  });
});
