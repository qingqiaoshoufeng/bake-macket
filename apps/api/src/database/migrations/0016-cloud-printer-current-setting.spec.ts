import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudPrinterCurrentSetting1718000000014 } from './0016-cloud-printer-current-setting.js';

const statementsOf = (query: ReturnType<typeof vi.fn>): string[] =>
  query.mock.calls.map(([sql]) => String(sql).replace(/\s+/gu, ' ').trim());

describe('CloudPrinterCurrentSetting1718000000014', () => {
  let previousMaintenanceMode: string | undefined;
  let previousWritersStopped: string | undefined;

  beforeEach(() => {
    previousMaintenanceMode = process.env.BAKE_MALL_MAINTENANCE_MODE;
    previousWritersStopped = process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED;
    process.env.BAKE_MALL_MAINTENANCE_MODE = '1';
    process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED = '1';
  });

  afterEach(() => {
    if (previousMaintenanceMode === undefined) {
      delete process.env.BAKE_MALL_MAINTENANCE_MODE;
    } else {
      process.env.BAKE_MALL_MAINTENANCE_MODE = previousMaintenanceMode;
    }
    if (previousWritersStopped === undefined) {
      delete process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED;
    } else {
      process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED = previousWritersStopped;
    }
  });

  it('声明禁用 TypeORM migration wrapper transaction，以兼容 LOCK TABLES', () => {
    expect(new CloudPrinterCurrentSetting1718000000014().transaction).toBe(
      false,
    );
  });

  it('创建全店唯一当前打印机设置并插入空 STORE singleton', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new CloudPrinterCurrentSetting1718000000014().up({ query } as never);

    const statements = statementsOf(query);
    const create = statements.find((sql) =>
      sql.includes('CREATE TABLE `cloud_printer_store_settings`'),
    );
    expect(create).toContain('`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    expect(create).toContain('`scope_key` VARCHAR(32) NOT NULL');
    expect(create).toContain('`current_printer_id` BIGINT UNSIGNED NULL');
    expect(create).toContain('`revision` INT UNSIGNED NOT NULL DEFAULT 1');
    expect(create).toContain('`updated_by_admin_id` BIGINT UNSIGNED NULL');
    expect(create).toContain(
      '`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(create).toContain(
      '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    );
    expect(create).toContain(
      'UNIQUE INDEX `uniq_cloud_printer_store_settings_scope_key` (`scope_key`)',
    );
    expect(create).toContain(
      'FOREIGN KEY (`current_printer_id`) REFERENCES `cloud_printers` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(create).toContain(
      'FOREIGN KEY (`updated_by_admin_id`) REFERENCES `admin_users` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT',
    );
    expect(create).toContain(
      'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );
    expect(statements.at(-1)).toBe(
      "INSERT INTO `cloud_printer_store_settings` (`scope_key`, `current_printer_id`, `revision`, `updated_by_admin_id`) VALUES ('STORE', NULL, 1, NULL)",
    );
  });

  it.each([
    [undefined, '1', /BAKE_MALL_MAINTENANCE_MODE=1/u],
    ['1', undefined, /BAKE_MALL_PRINTING_WRITERS_STOPPED=1/u],
  ] as const)(
    'down 缺少维护确认时于任何 query 前 fail closed',
    async (maintenanceMode, writersStopped, expectedMessage) => {
      if (maintenanceMode === undefined) {
        delete process.env.BAKE_MALL_MAINTENANCE_MODE;
      } else {
        process.env.BAKE_MALL_MAINTENANCE_MODE = maintenanceMode;
      }
      if (writersStopped === undefined) {
        delete process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED;
      } else {
        process.env.BAKE_MALL_PRINTING_WRITERS_STOPPED = writersStopped;
      }
      const query = vi.fn();

      await expect(
        new CloudPrinterCurrentSetting1718000000014().down({ query } as never),
      ).rejects.toThrow(expectedMessage);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('down 在写锁内检查 current 非空并拒绝 DROP，最后释放锁', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.startsWith('SELECT') ? [{ has_current: 1 }] : undefined,
    );

    await expect(
      new CloudPrinterCurrentSetting1718000000014().down({ query } as never),
    ).rejects.toThrow(/current|当前打印机/iu);

    expect(statementsOf(query)).toEqual([
      'LOCK TABLES `cloud_printer_store_settings` WRITE',
      'SELECT EXISTS(SELECT 1 FROM `cloud_printer_store_settings` WHERE `current_printer_id` IS NOT NULL LIMIT 1) AS `has_current`',
      'UNLOCK TABLES',
    ]);
  });

  it('down 在 current 为空时于同一写锁内 DROP 并最终释放锁', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.startsWith('SELECT') ? [{ has_current: 0 }] : undefined,
    );

    await new CloudPrinterCurrentSetting1718000000014().down({
      query,
    } as never);

    expect(statementsOf(query)).toEqual([
      'LOCK TABLES `cloud_printer_store_settings` WRITE',
      'SELECT EXISTS(SELECT 1 FROM `cloud_printer_store_settings` WHERE `current_printer_id` IS NOT NULL LIMIT 1) AS `has_current`',
      'DROP TABLE `cloud_printer_store_settings`',
      'UNLOCK TABLES',
    ]);
  });

  it('down 在 guard 或 DROP 失败时仍释放写锁', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT')) return [{ has_current: 0 }];
      if (sql.startsWith('DROP TABLE')) throw new Error('forced drop failure');
      return undefined;
    });

    await expect(
      new CloudPrinterCurrentSetting1718000000014().down({ query } as never),
    ).rejects.toThrow(/forced drop failure/iu);
    expect(statementsOf(query).at(-1)).toBe('UNLOCK TABLES');
  });
});
