import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudPrinters1718000000010 } from './0011-cloud-printers.js';

const statementsOf = (query: ReturnType<typeof vi.fn>): string[] =>
  query.mock.calls.map(([sql]) => String(sql));

const normalize = (sql: string): string => sql.replace(/\s+/gu, ' ').trim();

type SchemaSnapshot = Readonly<{
  tables: readonly string[];
}>;

const statefulRunner = (populatedTable?: string) => {
  let tables = ['cloud_printers', 'admin_operation_idempotency'];
  const ddl: string[] = [];
  const query = vi.fn(async (rawSql: string) => {
    const sql = String(rawSql);
    if (/^\s*(?:LOCK|UNLOCK) TABLES\b/iu.test(sql)) return undefined;
    if (/^\s*SELECT\b/iu.test(sql)) {
      return [
        {
          has_blocking_data: sql.includes(`FROM \`${populatedTable}\``) ? 1 : 0,
        },
      ];
    }
    ddl.push(sql);
    const dropped = sql.match(/DROP TABLE `([^`]+)`/u)?.[1];
    if (dropped) tables = tables.filter((table) => table !== dropped);
    return undefined;
  });

  return {
    query,
    ddl,
    snapshot: (): SchemaSnapshot => ({ tables: [...tables] }),
  };
};

describe('CloudPrinters1718000000010', () => {
  it('声明禁用 TypeORM migration wrapper transaction，以兼容 LOCK TABLES', () => {
    expect(new CloudPrinters1718000000010().transaction).toBe(false);
  });

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

  it('创建完整、安全且符合 MySQL 约定的 cloud_printers 表', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new CloudPrinters1718000000010().up({ query } as never);

    const create = statementsOf(query).find((sql) =>
      sql.includes('CREATE TABLE `cloud_printers`'),
    );
    expect(create).toBeDefined();
    const sql = normalize(create ?? '');
    expect(sql).toContain('`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    expect(sql).toContain('`serial_number` VARCHAR(64) NOT NULL');
    expect(sql).not.toMatch(
      /`serial_number`[^,\n]*(?:CHARACTER SET|COLLATE)/iu,
    );
    expect(sql).toContain('`display_name` VARCHAR(64) NOT NULL');
    expect(sql).toContain(
      "`status` ENUM('BINDING','PENDING_VERIFICATION','ACTIVE','UNBINDING','UNBOUND','ERROR') NOT NULL",
    );
    expect(sql).toContain(
      "`binding_stage` ENUM('NONE','ADD_PRINTER','PRINT_VERIFICATION_CODE','COMPENSATION_DELETE','UNBIND_DELETE','RECONCILIATION') NOT NULL",
    );
    expect(sql).toContain(
      "`vendor_relation_state` ENUM('UNKNOWN','CONFIRMED_BOUND','CONFIRMED_UNBOUND') NOT NULL",
    );
    expect(sql).toContain('`binding_idempotency_key` VARCHAR(128) NULL');
    expect(sql).toContain('`binding_operation_id` BIGINT UNSIGNED NULL');
    expect(sql).toContain(
      'INDEX `idx_cloud_printers_binding_operation` (`binding_operation_id`)',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_cloud_printers_binding_operation` FOREIGN KEY (`binding_operation_id`) REFERENCES `admin_operation_idempotency` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain('`verification_code_hash` VARCHAR(255) NULL');
    expect(sql).toContain('`verification_expires_at` DATETIME NULL');
    expect(sql).toContain(
      '`verification_failed_attempts` INT UNSIGNED NOT NULL DEFAULT 0',
    );
    expect(sql).toContain('`verified_at` DATETIME NULL');
    expect(sql).toContain(
      "`last_online_status` ENUM('UNKNOWN','OFFLINE','ONLINE','ABNORMAL') NOT NULL",
    );
    expect(sql).toContain('`last_status_checked_at` DATETIME NULL');
    expect(sql).toContain('`bound_by_admin_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain('`last_vendor_error_code` VARCHAR(64) NULL');
    expect(sql).toContain('`unbound_at` DATETIME NULL');
    expect(sql).toContain('`version` INT UNSIGNED NOT NULL DEFAULT 1');
    expect(sql).toContain(
      '`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(sql).toContain(
      '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    );
    expect(sql).toContain(
      'UNIQUE INDEX `uniq_cloud_printers_serial_number` (`serial_number`)',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_cloud_printers_bound_by_admin` FOREIGN KEY (`bound_by_admin_id`) REFERENCES `admin_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain('ENGINE=InnoDB');
    expect(sql).toContain('CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    expect(sql).not.toMatch(/userkey|user_key/iu);
  });

  it('同时创建管理员写操作幂等表及复合唯一键', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new CloudPrinters1718000000010().up({ query } as never);

    const statements = statementsOf(query);
    const createIndex = statements.findIndex((sql) =>
      sql.includes('CREATE TABLE `admin_operation_idempotency`'),
    );
    const cloudPrinterIndex = statements.findIndex((sql) =>
      sql.includes('CREATE TABLE `cloud_printers`'),
    );
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(cloudPrinterIndex).toBeGreaterThan(createIndex);
    const create = statements[createIndex];
    expect(create).toBeDefined();
    const sql = normalize(create ?? '');
    expect(sql).toContain('`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    expect(sql).toContain('`admin_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain('`operation` VARCHAR(64) NOT NULL');
    expect(sql).toContain('`key` VARCHAR(128) NOT NULL');
    expect(sql).not.toContain('owner_token_hash');
    expect(sql).toContain('`request_hash` CHAR(64) NOT NULL');
    expect(sql).not.toMatch(/`request_hash`[^,\n]*(?:CHARACTER SET|COLLATE)/iu);
    expect(sql).toContain(
      "`status` ENUM('IN_PROGRESS','COMPLETED','FAILED','UNKNOWN') NOT NULL",
    );
    expect(sql).toContain('`resource_type` VARCHAR(64) NULL');
    expect(sql).toContain('`resource_id` VARCHAR(64) NULL');
    expect(sql).toContain('`response_snapshot` JSON NULL');
    expect(sql).toContain(
      'UNIQUE INDEX `uniq_admin_operation_idempotency_scope` (`admin_id`, `operation`, `key`)',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_admin_operation_idempotency_admin` FOREIGN KEY (`admin_id`) REFERENCES `admin_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      '`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(sql).toContain(
      '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    );
    expect(sql).toContain('ENGINE=InnoDB');
    expect(sql).toContain('CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    expect(sql).not.toMatch(
      /`(?:password|operation_password|code|challenge|userkey|user_key|sign|token)`\s/iu,
    );
  });

  it.each([
    ['缺少 maintenance 确认', undefined, '1', /BAKE_MALL_MAINTENANCE_MODE=1/u],
    ['maintenance 确认值错误', 'true', '1', /BAKE_MALL_MAINTENANCE_MODE=1/u],
    [
      '缺少 printing writer 停止确认',
      '1',
      undefined,
      /BAKE_MALL_PRINTING_WRITERS_STOPPED=1/u,
    ],
    [
      'printing writer 停止确认值错误',
      '1',
      'true',
      /BAKE_MALL_PRINTING_WRITERS_STOPPED=1/u,
    ],
  ] as const)(
    'down 在%s时于任何 query 前 fail closed',
    async (_case, maintenanceMode, writersStopped, expectedMessage) => {
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
        new CloudPrinters1718000000010().down({ query } as never),
      ).rejects.toThrow(expectedMessage);

      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each(['cloud_printers', 'admin_operation_idempotency'])(
    'down 在 %s 有域数据时于任何 DDL 前拒绝并保持 schema snapshot 不变',
    async (populatedTable) => {
      const runner = statefulRunner(populatedTable);
      const before = runner.snapshot();

      await expect(
        new CloudPrinters1718000000010().down(runner as never),
      ).rejects.toThrow(/cannot revert|无法回滚/iu);

      expect(runner.ddl).toEqual([]);
      expect(runner.snapshot()).toEqual(before);
      const statements = statementsOf(runner.query);
      expect(normalize(statements[0] ?? '')).toBe(
        'LOCK TABLES `cloud_printers` WRITE, `admin_operation_idempotency` WRITE',
      );
      expect(statements.at(-1)).toMatch(/^\s*UNLOCK TABLES\s*$/iu);
      expect(statements).toHaveLength(4);
      expect(
        statements.slice(1, -1).every((sql) => /^\s*SELECT\b/iu.test(sql)),
      ).toBe(true);
    },
  );

  it('down 在 guard 返回异常形态时 fail closed 且不执行 DDL', async () => {
    const query = vi.fn(async (rawSql: string) => {
      const sql = String(rawSql);
      if (/^\s*(?:LOCK|UNLOCK) TABLES\b/iu.test(sql)) return undefined;
      return [];
    });

    await expect(
      new CloudPrinters1718000000010().down({ query } as never),
    ).rejects.toThrow(/guard|preflight|查询结果|invalid/iu);

    expect(
      statementsOf(query).some((sql) =>
        /^\s*(?:CREATE|ALTER|DROP)\b/iu.test(sql),
      ),
    ).toBe(false);
  });

  it('down 在两表均空时完成全部 preflight 后按 FK 安全顺序删除', async () => {
    const runner = statefulRunner();

    await new CloudPrinters1718000000010().down(runner as never);

    const statements = statementsOf(runner.query);
    expect(normalize(statements[0] ?? '')).toBe(
      'LOCK TABLES `cloud_printers` WRITE, `admin_operation_idempotency` WRITE',
    );
    expect(
      statements.slice(1, 3).every((sql) => /^\s*SELECT\b/iu.test(sql)),
    ).toBe(true);
    expect(statements.slice(3, 5).map(normalize)).toEqual([
      'DROP TABLE `cloud_printers`',
      'DROP TABLE `admin_operation_idempotency`',
    ]);
    expect(statements[5]).toMatch(/^\s*UNLOCK TABLES\s*$/iu);
    expect(runner.snapshot()).toEqual({ tables: [] });
  });
});
