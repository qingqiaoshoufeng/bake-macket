import { describe, expect, it, vi } from 'vitest';

import { PrintJobUnknownMetadata1718000000012 } from './0013-print-job-unknown-metadata.js';

const columnRows = (names: readonly string[]) =>
  names.map((column_name) => ({ column_name }));

function queryRunner(existingColumns: readonly string[]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('information_schema.COLUMNS')) {
      return columnRows(existingColumns);
    }
    return [];
  });
  return { query };
}

describe('0013 print job UNKNOWN metadata compatibility migration', () => {
  it('为已经执行旧版 0012 的表一次性补齐三个恢复字段', async () => {
    const runner = queryRunner([]);

    await new PrintJobUnknownMetadata1718000000012().up(runner as never);

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining('ADD COLUMN `unknown_since_at` DATETIME NULL'),
    );
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ADD COLUMN `unknown_query_count` INT UNSIGNED NOT NULL DEFAULT 0',
      ),
    );
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ADD COLUMN `last_unknown_query_at` DATETIME NULL',
      ),
    );
  });

  it('全新数据库的 0012 已含字段时安全 no-op', async () => {
    const runner = queryRunner([
      'unknown_since_at',
      'unknown_query_count',
      'last_unknown_query_at',
    ]);

    await new PrintJobUnknownMetadata1718000000012().up(runner as never);

    expect(runner.query).toHaveBeenCalledTimes(1);
  });
});
