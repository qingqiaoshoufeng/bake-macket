import { describe, expect, it, vi } from 'vitest';

import { OrderItemSourceIds1718000000007 } from './0008-order-item-source-ids.js';

const statementsOf = (query: ReturnType<typeof vi.fn>): string[] =>
  query.mock.calls.map(([sql]) => String(sql));

describe('OrderItemSourceIds1718000000007', () => {
  it('adds nullable unsigned source IDs and indexes without foreign keys', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new OrderItemSourceIds1718000000007().up({ query } as never);

    const statements = statementsOf(query);
    const sql = statements.join('\n');
    expect(sql).toContain('ADD COLUMN `product_id` BIGINT UNSIGNED NULL');
    expect(sql).toContain('ADD COLUMN `sku_id` BIGINT UNSIGNED NULL');
    expect(sql).toContain(
      'CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`)',
    );
    expect(sql).toContain(
      'CREATE INDEX `idx_order_items_sku` ON `order_items` (`sku_id`)',
    );
    expect(sql).not.toMatch(/FOREIGN KEY|ADD CONSTRAINT/);
  });

  it('backfills only a unique exact product, SKU and JSON specification match', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new OrderItemSourceIds1718000000007().up({ query } as never);

    const update = statementsOf(query).find((sql) =>
      sql.startsWith('UPDATE `order_items` item'),
    );
    expect(update).toBeDefined();
    expect(update).toContain('product.`name` = source.`product_name`');
    expect(update).toContain('sku.`name` = source.`sku_name`');
    expect(update).toContain(
      'CAST(sku.`attributes` AS CHAR) = CAST(source.`sku_attributes` AS CHAR)',
    );
    expect(update).toContain('GROUP BY source.`id`');
    expect(update).toContain('HAVING COUNT(*) = 1');
    expect(update).toContain(
      'SET item.`product_id` = matched.`product_id`,\n    item.`sku_id` = matched.`sku_id`',
    );
    expect(update).not.toMatch(
      /product_name\s*=|sku_name\s*=|sku_attributes\s*=/,
    );
  });

  it('drops indexes before dropping the source ID columns', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new OrderItemSourceIds1718000000007().down({ query } as never);

    const statements = statementsOf(query);
    expect(statements).toEqual([
      expect.stringContaining('DROP INDEX `idx_order_items_sku`'),
      expect.stringContaining('DROP INDEX `idx_order_items_product`'),
      expect.stringContaining('DROP COLUMN `sku_id`'),
      expect.stringContaining('DROP COLUMN `product_id`'),
    ]);
  });
});
