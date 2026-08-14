import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudPrintJobs1718000000011 } from './0013-cloud-print-jobs.js';

const statementsOf = (query: ReturnType<typeof vi.fn>): string[] =>
  query.mock.calls.map(([sql]) => String(sql));

const normalize = (sql: string): string => sql.replace(/\s+/gu, ' ').trim();

type SchemaSnapshot = Readonly<{ tables: readonly string[] }>;

const STAGING_BATCHES = '__0012_print_batches_staging';
const STAGING_JOBS = '__0012_print_jobs_staging';
const STAGING_MARKER = 'bake-mall:0012-cloud-print-jobs:staging:v1';

const tableNamesIn = (sql: string): string[] =>
  [...sql.matchAll(/`([^`]+)`/gu)].map(([, table]) => table ?? '');

const statefulDownRunner = (
  populatedTable?: string,
  options: Readonly<{ failDrop?: boolean }> = {},
) => {
  let tables = ['print_batches', 'print_jobs'];
  const ddl: string[] = [];
  const query = vi.fn(async (rawSql: string) => {
    const sql = String(rawSql);
    if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
    if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
    if (/^\s*(?:LOCK|UNLOCK) TABLES\b/iu.test(sql)) return undefined;
    if (/^\s*SELECT\b/iu.test(sql)) {
      return [
        {
          has_blocking_data: sql.includes(`FROM \`${populatedTable}\``) ? 1 : 0,
        },
      ];
    }
    ddl.push(sql);
    if (/^\s*DROP TABLE\b/iu.test(sql)) {
      if (options.failDrop) throw new Error('forced atomic drop failure');
      const droppedTables = tableNamesIn(sql);
      tables = tables.filter((table) => !droppedTables.includes(table));
    }
    return undefined;
  });

  return {
    query,
    ddl,
    snapshot: (): SchemaSnapshot => ({ tables: [...tables] }),
  };
};

const statefulUpRunner = () => {
  let tables: string[] = [];
  let shouldFailJobsCreate = true;
  const query = vi.fn(async (rawSql: string, parameters?: unknown[]) => {
    const sql = normalize(String(rawSql));
    if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
    if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
    if (sql.includes('information_schema.TABLES')) {
      const table = String(parameters?.at(-1) ?? '');
      if (!tables.includes(table)) return [];
      return [
        {
          table_comment: STAGING_MARKER,
          matched_columns: table === STAGING_JOBS ? 5 : 3,
        },
      ];
    }
    if (sql.startsWith('DROP TABLE IF EXISTS')) {
      const droppedTables = tableNamesIn(sql);
      tables = tables.filter((table) => !droppedTables.includes(table));
      return undefined;
    }
    const createdTable = sql.match(/^CREATE TABLE `([^`]+)`/u)?.[1];
    if (createdTable) {
      if (createdTable === STAGING_JOBS && shouldFailJobsCreate) {
        shouldFailJobsCreate = false;
        throw new Error('forced staging jobs create failure');
      }
      tables = [...tables, createdTable];
      return undefined;
    }
    if (sql.startsWith('RENAME TABLE')) {
      const renames = [
        [STAGING_BATCHES, 'print_batches'],
        [STAGING_JOBS, 'print_jobs'],
      ] as const;
      if (renames.some(([source]) => !tables.includes(source))) {
        throw new Error('missing rename source');
      }
      tables = tables
        .filter((table) => !renames.some(([source]) => source === table))
        .concat(renames.map(([, target]) => target));
    }
    return undefined;
  });

  return {
    query,
    snapshot: (): SchemaSnapshot => ({ tables: [...tables].sort() }),
  };
};

const createSql = async (
  table: 'print_batches' | 'print_jobs',
): Promise<string> => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
    if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
    if (sql.includes('information_schema.TABLES')) return [];
    return undefined;
  });
  await new CloudPrintJobs1718000000011().up({ query } as never);
  const stagingTable =
    table === 'print_batches' ? STAGING_BATCHES : STAGING_JOBS;
  const statement = statementsOf(query).find(
    (sql) =>
      sql.includes(`CREATE TABLE \`${table}\``) ||
      sql.includes(`CREATE TABLE \`${stagingTable}\``),
  );
  expect(statement).toBeDefined();
  return normalize(statement ?? '')
    .replaceAll(STAGING_BATCHES, 'print_batches')
    .replaceAll(STAGING_JOBS, 'print_jobs');
};

describe('CloudPrintJobs1718000000011', () => {
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

  it('禁用 migration wrapper transaction，以便 down 原子完成数据 preflight 与 DDL', () => {
    expect(new CloudPrintJobs1718000000011().transaction).toBe(false);
  });

  it('创建完整 print_batches schema、终态计数不变量与 lease/queue 索引', async () => {
    const sql = await createSql('print_batches');

    expect(sql).toContain('`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    expect(sql).toContain('`printer_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain('`created_by_admin_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain(
      "`status` ENUM('DRAFT','READY','RUNNING','PAUSED','COMPLETED','COMPLETED_WITH_ISSUES','CANCELLED') NOT NULL DEFAULT 'DRAFT'",
    );
    expect(sql).toContain('`lease_owner` VARCHAR(128) NULL');
    expect(sql).toContain('`lease_expires_at` DATETIME NULL');
    for (const counter of [
      'total_count',
      'classified_count',
      'accepted_count',
      'failed_count',
      'manual_review_count',
      'manually_resolved_count',
      'cancelled_count',
    ]) {
      expect(sql).toContain(`\`${counter}\` INT UNSIGNED NOT NULL DEFAULT 0`);
    }
    expect(sql).not.toMatch(/`(?:pending|submitting|unknown)_count`/iu);
    expect(sql).toContain(
      'CONSTRAINT `chk_print_batches_classified_count` CHECK (`classified_count` = `accepted_count` + `failed_count` + `manually_resolved_count` + `cancelled_count`)',
    );
    expect(sql).toContain(
      'CONSTRAINT `chk_print_batches_progress_count` CHECK (`classified_count` + `manual_review_count` <= `total_count`)',
    );
    expect(sql).toContain(
      'INDEX `idx_print_batches_queue` (`status`, `lease_expires_at`, `id`)',
    );
    expect(sql).toContain(
      'INDEX `idx_print_batches_lease` (`lease_owner`, `lease_expires_at`)',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_print_batches_printer` FOREIGN KEY (`printer_id`) REFERENCES `cloud_printers` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_print_batches_created_by_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).toContain(
      '`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(sql).toContain(
      '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    );
    expect(sql).toContain('ENGINE=InnoDB');
    expect(sql).toContain('CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
  });

  it('创建完整 print_jobs schema、enum、唯一约束、队列索引与全部外键', async () => {
    const sql = await createSql('print_jobs');

    expect(sql).toContain('`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    expect(sql).toContain('`batch_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain('`order_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain('`printer_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain('`sequence` INT UNSIGNED NOT NULL');
    expect(sql).toContain(
      "`status` ENUM('PENDING','SUBMITTING','ACCEPTED','FAILED','UNKNOWN','MANUAL_REVIEW','MANUALLY_CONFIRMED_PRINTED','MANUALLY_CLOSED','CANCELLED') NOT NULL DEFAULT 'PENDING'",
    );
    expect(sql).toContain('`payload_json` JSON NULL');
    expect(sql).toContain('`payload_hash` CHAR(64) NOT NULL');
    expect(sql).toContain('`payload_redacted_at` DATETIME NULL');
    expect(sql).toContain('`vendor_job_id` VARCHAR(128) NULL');
    expect(sql).toContain('`vendor_error_code` VARCHAR(64) NULL');
    expect(sql).toContain('`accepted_at` DATETIME NULL');
    expect(sql).toContain('`unknown_since_at` DATETIME NULL');
    expect(sql).toContain(
      '`unknown_query_count` INT UNSIGNED NOT NULL DEFAULT 0',
    );
    expect(sql).toContain('`last_unknown_query_at` DATETIME NULL');
    expect(sql).toContain('`created_by_admin_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain(
      "`manual_resolution` ENUM('CONFIRM_PRINTED','CONFIRM_NOT_PRINTED','RETRY_WITH_DUPLICATE_RISK') NULL",
    );
    expect(sql).toContain(
      '`manual_resolution_by_admin_id` BIGINT UNSIGNED NULL',
    );
    expect(sql).toContain('`manual_resolution_at` DATETIME NULL');
    expect(sql).toContain('`supersedes_job_id` BIGINT UNSIGNED NULL');
    expect(sql).not.toMatch(/`idempotency_key`/iu);
    expect(sql).not.toMatch(/\b(?:FLOAT|DOUBLE|DECIMAL)\b/iu);
    expect(sql).toContain(
      'UNIQUE INDEX `uniq_print_jobs_batch_order` (`batch_id`, `order_id`)',
    );
    expect(sql).toContain(
      'UNIQUE INDEX `uniq_print_jobs_order_sequence` (`order_id`, `sequence`)',
    );
    expect(sql).toContain(
      'INDEX `idx_print_jobs_queue` (`batch_id`, `status`, `sequence`)',
    );
    for (const foreignKey of [
      'CONSTRAINT `fk_print_jobs_batch` FOREIGN KEY (`batch_id`) REFERENCES `print_batches` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
      'CONSTRAINT `fk_print_jobs_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
      'CONSTRAINT `fk_print_jobs_printer` FOREIGN KEY (`printer_id`) REFERENCES `cloud_printers` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
      'CONSTRAINT `fk_print_jobs_created_by_admin` FOREIGN KEY (`created_by_admin_id`) REFERENCES `admin_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
      'CONSTRAINT `fk_print_jobs_manual_resolution_admin` FOREIGN KEY (`manual_resolution_by_admin_id`) REFERENCES `admin_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
      'CONSTRAINT `fk_print_jobs_supersedes` FOREIGN KEY (`supersedes_job_id`) REFERENCES `print_jobs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    ]) {
      expect(sql).toContain(foreignKey);
    }
    expect(sql).toContain(
      '`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    );
    expect(sql).toContain(
      '`updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    );
    expect(sql).toContain('ENGINE=InnoDB');
    expect(sql).toContain('CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
  });

  it('up 通过专属 staging 表和单条 atomic rename 发布最终 schema', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
      if (sql.includes('information_schema.TABLES')) return [];
      return undefined;
    });

    await new CloudPrintJobs1718000000011().up({ query } as never);

    const statements = statementsOf(query).map(normalize);
    const ddl = statements.filter((sql) =>
      /^(?:DROP|CREATE|RENAME) TABLE\b/iu.test(sql),
    );
    expect(ddl.slice(0, 2)).toEqual([
      expect.stringContaining(`CREATE TABLE \`${STAGING_BATCHES}\``),
      expect.stringContaining(`CREATE TABLE \`${STAGING_JOBS}\``),
    ]);
    expect(ddl[1]).toContain(`REFERENCES \`${STAGING_BATCHES}\` (\`id\`)`);
    expect(ddl[1]).toContain(`REFERENCES \`${STAGING_JOBS}\` (\`id\`)`);
    expect(ddl[2]).toBe(
      `RENAME TABLE \`${STAGING_BATCHES}\` TO \`print_batches\`, \`${STAGING_JOBS}\` TO \`print_jobs\``,
    );
    expect(
      statements.filter((sql) => /^RENAME TABLE\b/iu.test(sql)),
    ).toHaveLength(1);
    expect(
      statements.some((sql) => /CREATE TABLE IF NOT EXISTS/iu.test(sql)),
    ).toBe(false);
    expect(statements.at(0)).toContain('GET_LOCK');
    expect(statements.at(-1)).toContain('RELEASE_LOCK');
  });

  it('up 第二张 staging create 失败时不暴露最终表，重跑清理 leftover 后成功', async () => {
    const runner = statefulUpRunner();
    const migration = new CloudPrintJobs1718000000011();

    await expect(migration.up(runner as never)).rejects.toThrow(
      /forced staging jobs create failure/iu,
    );
    expect(runner.snapshot()).toEqual({ tables: [STAGING_BATCHES] });
    expect(runner.snapshot().tables).not.toContain('print_batches');
    expect(runner.snapshot().tables).not.toContain('print_jobs');

    await expect(migration.up(runner as never)).resolves.toBeUndefined();
    expect(runner.snapshot()).toEqual({
      tables: ['print_batches', 'print_jobs'],
    });
  });

  it('同名外部 staging 表 marker 不匹配时拒绝且绝不删除', async () => {
    const statements: string[] = [];
    const query = vi.fn(async (rawSql: string) => {
      const sql = normalize(String(rawSql));
      statements.push(sql);
      if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
      if (sql.includes('information_schema.TABLES')) {
        return [{ table_comment: 'external-owner', matched_columns: 3 }];
      }
      return undefined;
    });

    await expect(
      new CloudPrintJobs1718000000011().up({ query } as never),
    ).rejects.toThrow(/ownership marker|所有权|不匹配/iu);
    expect(statements.some((sql) => sql.startsWith('DROP TABLE'))).toBe(false);
    expect(statements.some((sql) => sql.includes('RELEASE_LOCK'))).toBe(true);
  });

  it('自有 marker 且最小结构匹配时才清理 leftover staging 表', async () => {
    const statements: string[] = [];
    const query = vi.fn(async (rawSql: string, parameters?: unknown[]) => {
      const sql = normalize(String(rawSql));
      statements.push(sql);
      if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
      if (sql.includes('information_schema.TABLES')) {
        const table = String(parameters?.at(-1) ?? '');
        return [
          {
            table_comment: STAGING_MARKER,
            matched_columns: table === STAGING_JOBS ? 5 : 3,
          },
        ];
      }
      return undefined;
    });

    await expect(
      new CloudPrintJobs1718000000011().up({ query } as never),
    ).resolves.toBeUndefined();
    const cleanup = statements.filter((sql) =>
      sql.startsWith('DROP TABLE IF EXISTS'),
    );
    expect(cleanup).toHaveLength(1);
    expect(cleanup[0]).toContain(STAGING_BATCHES);
    expect(cleanup[0]).toContain(STAGING_JOBS);
  });

  it('自有 marker 但最小结构不匹配时拒绝且绝不删除', async () => {
    const statements: string[] = [];
    const query = vi.fn(async (rawSql: string) => {
      const sql = normalize(String(rawSql));
      statements.push(sql);
      if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
      if (sql.includes('information_schema.TABLES')) {
        return [{ table_comment: STAGING_MARKER, matched_columns: 0 }];
      }
      return undefined;
    });

    await expect(
      new CloudPrintJobs1718000000011().up({ query } as never),
    ).rejects.toThrow(/minimum structure|最小结构|不匹配/iu);
    expect(statements.some((sql) => sql.startsWith('DROP TABLE'))).toBe(false);
    expect(statements.at(-1)).toContain('RELEASE_LOCK');
  });

  it.each(['up', 'down'] as const)(
    '%s advisory lock 获取失败时拒绝且不执行迁移 DDL',
    async (direction) => {
      const statements: string[] = [];
      const query = vi.fn(async (rawSql: string) => {
        const sql = normalize(String(rawSql));
        statements.push(sql);
        if (sql.includes('GET_LOCK')) return [{ lock_acquired: 0 }];
        return undefined;
      });

      await expect(
        new CloudPrintJobs1718000000011()[direction]({ query } as never),
      ).rejects.toThrow(/advisory lock|迁移锁|超时/iu);
      expect(
        statements.some((sql) =>
          /^(?:LOCK|DROP|CREATE|RENAME) TABLE/iu.test(sql),
        ),
      ).toBe(false);
      expect(statements.some((sql) => sql.includes('RELEASE_LOCK'))).toBe(
        false,
      );
    },
  );

  it('up 异常时释放 advisory lock', async () => {
    const query = vi.fn(async (rawSql: string) => {
      const sql = normalize(String(rawSql));
      if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
      if (sql.includes('information_schema.TABLES')) return [];
      if (sql.startsWith('CREATE TABLE'))
        throw new Error('forced create failure');
      return undefined;
    });

    await expect(
      new CloudPrintJobs1718000000011().up({ query } as never),
    ).rejects.toThrow(/forced create failure/iu);
    expect(normalize(statementsOf(query).at(-1) ?? '')).toContain(
      'RELEASE_LOCK',
    );
  });

  it.each(['CREATE TABLE', 'RENAME TABLE'] as const)(
    'up 主体 %s 失败且 advisory cleanup 失败时保留主体错误',
    async (failurePoint) => {
      const originalError = new Error(`forced ${failurePoint} failure`);
      const releaseError = new Error('forced advisory unlock failure');
      const query = vi.fn(async (rawSql: string) => {
        const sql = normalize(String(rawSql));
        if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
        if (sql.includes('RELEASE_LOCK')) throw releaseError;
        if (sql.includes('information_schema.TABLES')) return [];
        if (sql.startsWith(failurePoint)) throw originalError;
        return undefined;
      });

      const rejection = await new CloudPrintJobs1718000000011()
        .up({ query } as never)
        .catch((error: unknown) => error);

      expect(rejection).toBe(originalError);
      expect(
        (rejection as Error & { suppressed?: readonly unknown[] }).suppressed,
      ).toEqual([releaseError]);
      expect(normalize(statementsOf(query).at(-1) ?? '')).toContain(
        'RELEASE_LOCK',
      );
    },
  );

  it.each([
    {
      failurePoint: 'guard',
      failUnlock: true,
      expectedCleanupErrors: ['unlock', 'release'],
    },
    {
      failurePoint: 'drop',
      failUnlock: false,
      expectedCleanupErrors: ['release'],
    },
  ] as const)(
    'down 主体 $failurePoint 失败且 cleanup 失败时保留主体错误',
    async ({ failurePoint, failUnlock, expectedCleanupErrors }) => {
      const originalError = new Error(`forced ${failurePoint} failure`);
      const unlockError = new Error('forced table unlock failure');
      const releaseError = new Error('forced advisory unlock failure');
      const query = vi.fn(async (rawSql: string) => {
        const sql = normalize(String(rawSql));
        if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
        if (sql.includes('RELEASE_LOCK')) throw releaseError;
        if (sql.startsWith('LOCK TABLES')) return undefined;
        if (sql.startsWith('UNLOCK TABLES')) {
          if (failUnlock) throw unlockError;
          return undefined;
        }
        if (sql.startsWith('SELECT EXISTS')) {
          if (failurePoint === 'guard') throw originalError;
          return [{ has_blocking_data: 0 }];
        }
        if (sql.startsWith('DROP TABLE')) throw originalError;
        return undefined;
      });

      const rejection = await new CloudPrintJobs1718000000011()
        .down({ query } as never)
        .catch((error: unknown) => error);

      expect(rejection).toBe(originalError);
      const cleanupErrors = { unlock: unlockError, release: releaseError };
      expect(
        (rejection as Error & { suppressed?: readonly unknown[] }).suppressed,
      ).toEqual(expectedCleanupErrors.map((name) => cleanupErrors[name]));
      const statements = statementsOf(query).map(normalize);
      expect(statements.at(-2)).toBe('UNLOCK TABLES');
      expect(statements.at(-1)).toContain('RELEASE_LOCK');
    },
  );

  it('up 主体成功但 advisory cleanup 失败时报告 cleanup error', async () => {
    const releaseError = new Error('forced advisory unlock failure');
    const query = vi.fn(async (rawSql: string) => {
      const sql = normalize(String(rawSql));
      if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) throw releaseError;
      if (sql.includes('information_schema.TABLES')) return [];
      return undefined;
    });

    const rejection = await new CloudPrintJobs1718000000011()
      .up({ query } as never)
      .catch((error: unknown) => error);

    expect(rejection).toBe(releaseError);
  });

  it('down 主体成功但两个 cleanup 均失败时报告首个 cleanup error 并继续释放 advisory lock', async () => {
    const unlockError = new Error('forced table unlock failure');
    const releaseError = new Error('forced advisory unlock failure');
    const query = vi.fn(async (rawSql: string) => {
      const sql = normalize(String(rawSql));
      if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) throw releaseError;
      if (sql.startsWith('LOCK TABLES')) return undefined;
      if (sql.startsWith('UNLOCK TABLES')) throw unlockError;
      if (sql.startsWith('SELECT EXISTS')) return [{ has_blocking_data: 0 }];
      return undefined;
    });

    const rejection = await new CloudPrintJobs1718000000011()
      .down({ query } as never)
      .catch((error: unknown) => error);

    expect(rejection).toBe(unlockError);
    expect(
      (rejection as Error & { suppressed?: readonly unknown[] }).suppressed,
    ).toEqual([releaseError]);
    const statements = statementsOf(query).map(normalize);
    expect(statements.at(-2)).toBe('UNLOCK TABLES');
    expect(statements.at(-1)).toContain('RELEASE_LOCK');
  });

  it('两个 runner 共享固定 advisory lock，后者获取失败时不进入迁移流程', async () => {
    let owner: 'first' | 'second' | undefined;
    let firstHasLock!: () => void;
    const firstLocked = new Promise<void>((resolve) => {
      firstHasLock = resolve;
    });
    let continueFirst!: () => void;
    const firstMayContinue = new Promise<void>((resolve) => {
      continueFirst = resolve;
    });
    const runner = (runnerId: 'first' | 'second') => {
      const statements: string[] = [];
      const query = vi.fn(async (rawSql: string) => {
        const sql = normalize(String(rawSql));
        statements.push(sql);
        if (sql.includes('GET_LOCK')) {
          if (owner === undefined) {
            owner = runnerId;
            if (runnerId === 'first') firstHasLock();
            return [{ lock_acquired: 1 }];
          }
          return [{ lock_acquired: owner === runnerId ? 1 : 0 }];
        }
        if (sql.includes('RELEASE_LOCK')) {
          if (owner !== runnerId) return [{ lock_released: 0 }];
          owner = undefined;
          return [{ lock_released: 1 }];
        }
        if (sql.includes('information_schema.TABLES')) return [];
        if (runnerId === 'first' && sql.startsWith('CREATE TABLE')) {
          await firstMayContinue;
          throw new Error('finish first runner');
        }
        return undefined;
      });
      return { query, statements };
    };
    const first = runner('first');
    const second = runner('second');

    const firstUp = new CloudPrintJobs1718000000011().up(first as never);
    await firstLocked;
    await expect(
      new CloudPrintJobs1718000000011().up(second as never),
    ).rejects.toThrow(/advisory lock|迁移锁|超时/iu);
    expect(
      second.statements.some((sql) =>
        /^(?:DROP|CREATE|RENAME) TABLE/iu.test(sql),
      ),
    ).toBe(false);
    continueFirst();
    await expect(firstUp).rejects.toThrow(/finish first runner/iu);
    expect(owner).toBeUndefined();
  });

  it('down 在 DDL 异常时释放 advisory lock 和 table lock', async () => {
    const query = vi.fn(async (rawSql: string) => {
      const sql = normalize(String(rawSql));
      if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
      if (sql.includes('LOCK TABLES') || sql.includes('UNLOCK TABLES'))
        return undefined;
      if (sql.startsWith('SELECT EXISTS')) return [{ has_blocking_data: 0 }];
      if (sql.startsWith('DROP TABLE')) throw new Error('forced drop failure');
      return undefined;
    });

    await expect(
      new CloudPrintJobs1718000000011().down({ query } as never),
    ).rejects.toThrow(/forced drop failure/iu);
    const statements = statementsOf(query).map(normalize);
    expect(statements.at(-2)).toContain('UNLOCK TABLES');
    expect(statements.at(-1)).toContain('RELEASE_LOCK');
  });

  it.each(['print_batches', 'print_jobs'])(
    'down 在 %s 有域数据时于任何 DDL 前拒绝并保持 schema 原样',
    async (populatedTable) => {
      const runner = statefulDownRunner(populatedTable);
      const before = runner.snapshot();

      await expect(
        new CloudPrintJobs1718000000011().down(runner as never),
      ).rejects.toThrow(/cannot revert|无法回滚/iu);

      expect(runner.ddl).toEqual([]);
      expect(runner.snapshot()).toEqual(before);
      const statements = statementsOf(runner.query);
      expect(normalize(statements[0] ?? '')).toContain('GET_LOCK');
      expect(normalize(statements[1] ?? '')).toBe(
        'LOCK TABLES `print_jobs` WRITE, `print_batches` WRITE',
      );
      expect(statements.at(-2)).toMatch(/^\s*UNLOCK TABLES\s*$/iu);
      expect(normalize(statements.at(-1) ?? '')).toContain('RELEASE_LOCK');
      expect(statements).toHaveLength(6);
    },
  );

  it('down 在 guard 返回异常形态时 fail closed 且不执行 DDL', async () => {
    const query = vi.fn(async (rawSql: string) => {
      const sql = String(rawSql);
      if (sql.includes('GET_LOCK')) return [{ lock_acquired: 1 }];
      if (sql.includes('RELEASE_LOCK')) return [{ lock_released: 1 }];
      if (/^\s*(?:LOCK|UNLOCK) TABLES\b/iu.test(sql)) return undefined;
      return [];
    });

    await expect(
      new CloudPrintJobs1718000000011().down({ query } as never),
    ).rejects.toThrow(/guard|preflight|查询结果|invalid/iu);

    expect(
      statementsOf(query).some((sql) =>
        /^\s*(?:CREATE|ALTER|DROP)\b/iu.test(sql),
      ),
    ).toBe(false);
  });

  it('down 在两表均空时完成全部 preflight 后用单条 multi-table DDL 原子删除', async () => {
    const runner = statefulDownRunner();

    await new CloudPrintJobs1718000000011().down(runner as never);

    const statements = statementsOf(runner.query);
    expect(normalize(statements[0] ?? '')).toContain('GET_LOCK');
    expect(normalize(statements[1] ?? '')).toBe(
      'LOCK TABLES `print_jobs` WRITE, `print_batches` WRITE',
    );
    expect(
      statements.slice(2, 4).every((sql) => /^\s*SELECT\b/iu.test(sql)),
    ).toBe(true);
    expect(statements.slice(4, 5).map(normalize)).toEqual([
      'DROP TABLE `print_jobs`, `print_batches`',
    ]);
    expect(
      statements.filter((sql) => /^\s*DROP TABLE\b/iu.test(sql)),
    ).toHaveLength(1);
    expect(statements[5]).toMatch(/^\s*UNLOCK TABLES\s*$/iu);
    expect(normalize(statements[6] ?? '')).toContain('RELEASE_LOCK');
    expect(runner.snapshot()).toEqual({ tables: [] });
  });

  it('down atomic drop 故障时不会留下半 schema，并且始终 unlock', async () => {
    const runner = statefulDownRunner(undefined, { failDrop: true });
    const before = runner.snapshot();

    await expect(
      new CloudPrintJobs1718000000011().down(runner as never),
    ).rejects.toThrow(/forced atomic drop failure/iu);

    expect(runner.snapshot()).toEqual(before);
    expect(runner.ddl.map(normalize)).toEqual([
      'DROP TABLE `print_jobs`, `print_batches`',
    ]);
    const statements = statementsOf(runner.query);
    expect(statements.at(-2)).toMatch(/^\s*UNLOCK TABLES\s*$/iu);
    expect(normalize(statements.at(-1) ?? '')).toContain('RELEASE_LOCK');
  });
});
