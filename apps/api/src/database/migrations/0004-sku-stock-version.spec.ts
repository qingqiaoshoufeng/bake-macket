import { describe, expect, it, vi } from 'vitest';

import { SkuStockVersion1718000000003 } from './0004-sku-stock-version.js';

describe('SkuStockVersion migration', () => {
  it('adds and removes the unsigned version column', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const runner = { query } as never;
    const migration = new SkuStockVersion1718000000003();

    await migration.up(runner);
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE `skus` ADD `stock_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `stock`',
    );

    query.mockClear();
    await migration.down(runner);
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE `skus` DROP COLUMN `stock_version`',
    );
  });
});
