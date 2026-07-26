import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MembershipEntitlementSegmentKind } from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { MembershipEntitlementSegments1718000000005 } from './0006-membership-entitlement-segments.js';

const PROJECT_ROOT = resolve(__dirname, '../../../../..');

function source(path: string): string {
  return readFileSync(resolve(PROJECT_ROOT, path), 'utf8');
}

function statements(query: ReturnType<typeof vi.fn>): string[] {
  return query.mock.calls.map(([sql]) => String(sql));
}

function successfulQueryRunner(): {
  query: ReturnType<typeof vi.fn>;
} {
  return { query: vi.fn().mockResolvedValue([]) };
}

describe('MembershipEntitlementSegments migration', () => {
  it('creates the entitlement segment table with the exact schema invariants', async () => {
    const runner = successfulQueryRunner();

    await new MembershipEntitlementSegments1718000000005().up(runner as never);

    const sql = statements(runner.query).find((statement) =>
      statement.startsWith('CREATE TABLE `membership_entitlement_segments`'),
    );
    expect(sql).toBeDefined();
    expect(sql).toContain('`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT');
    expect(sql).toContain('`membership_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain('`purchase_order_id` BIGINT UNSIGNED NOT NULL');
    expect(sql).toContain(
      "`kind` ENUM('INITIAL','RENEWAL','UPGRADE') NOT NULL",
    );
    expect(sql).toContain('`starts_at` DATETIME NOT NULL');
    expect(sql).toContain('`ends_at` DATETIME NOT NULL');
    expect(sql).toContain('`previous_membership_id` BIGINT UNSIGNED NULL');
    expect(sql).toContain('`previous_membership_ends_at` DATETIME NULL');
    expect(sql).toContain(
      'UNIQUE INDEX `uniq_membership_entitlement_segments_purchase` (`purchase_order_id`)',
    );
    expect(sql).toContain(
      'INDEX `idx_membership_entitlement_segments_membership_period` (`membership_id`, `ends_at`, `id`)',
    );
    expect(sql).toContain(
      'CONSTRAINT `chk_membership_entitlement_segments_period` CHECK (`ends_at` > `starts_at`)',
    );
    expect(sql).toContain(
      'CONSTRAINT `chk_membership_entitlement_segments_upgrade_restore` CHECK',
    );
    expect(sql).toContain(
      "(`kind` = 'UPGRADE' AND `previous_membership_id` IS NOT NULL AND `previous_membership_ends_at` IS NOT NULL)",
    );
    expect(sql).toContain(
      "(`kind` IN ('INITIAL','RENEWAL') AND `previous_membership_id` IS NULL AND `previous_membership_ends_at` IS NULL)",
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_membership_entitlement_segments_membership` FOREIGN KEY (`membership_id`) REFERENCES `user_memberships` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_membership_entitlement_segments_purchase` FOREIGN KEY (`purchase_order_id`) REFERENCES `membership_purchase_orders` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain(
      'CONSTRAINT `fk_membership_entitlement_segments_previous` FOREIGN KEY (`previous_membership_id`) REFERENCES `user_memberships` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT',
    );
    expect(sql).not.toContain(
      'CONSTRAINT `fk_membership_entitlement_segments_previous` FOREIGN KEY (`previous_membership_id`) REFERENCES `user_memberships` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain(
      'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );
    expect(
      statements(runner.query).filter((statement) =>
        statement.startsWith('CREATE TABLE `membership_entitlement_segments`'),
      ),
    ).toHaveLength(1);
    expect(
      statements(runner.query).some((statement) =>
        statement.includes('previousOnUpdate'),
      ),
    ).toBe(false);
  });

  it('runs every source-data preflight before CREATE TABLE', async () => {
    const runner = successfulQueryRunner();

    await new MembershipEntitlementSegments1718000000005().up(runner as never);

    const sql = statements(runner.query);
    const createIndex = sql.findIndex((statement) =>
      statement.startsWith('CREATE TABLE `membership_entitlement_segments`'),
    );
    const preflightIndexes = sql
      .map((statement, index) =>
        statement.includes('preflight:') ? index : undefined,
      )
      .filter((index): index is number => index !== undefined);
    expect(preflightIndexes).not.toHaveLength(0);
    expect(preflightIndexes.every((index) => index < createIndex)).toBe(true);
    expect(sql.join('\n')).toContain('preflight:purchase-state-shape');
    expect(sql.join('\n')).toContain(
      'preflight:fulfilled-membership-cardinality',
    );
    expect(sql.join('\n')).toContain(
      'preflight:fulfilled-membership-integrity',
    );
    expect(sql.join('\n')).toContain('preflight:membership-period');
    expect(sql.join('\n')).toContain('preflight:voided-time-order');
  });

  it.each([
    ['purchase-state-shape', '11'],
    ['fulfilled-membership-cardinality', '22'],
    ['fulfilled-membership-integrity', '33'],
    ['membership-period', '44'],
    ['voided-time-order', '55'],
  ])(
    'rejects the %s preflight category with a sample purchase ID before DDL',
    async (category, sampleId) => {
      const query = vi.fn(async (sql: string) =>
        sql.includes(`preflight:${category}`) ? [{ id: sampleId }] : [],
      );

      await expect(
        new MembershipEntitlementSegments1718000000005().up({ query } as never),
      ).rejects.toThrow(new RegExp(`${category}.*${sampleId}`, 'i'));
      expect(
        statements(query).some((sql) => sql.startsWith('CREATE TABLE')),
      ).toBe(false);
    },
  );

  it('strictly accepts only the three legal purchase state/time shapes', async () => {
    const runner = successfulQueryRunner();

    await new MembershipEntitlementSegments1718000000005().up(runner as never);

    const sql = statements(runner.query).find((statement) =>
      statement.includes('preflight:purchase-state-shape'),
    );
    expect(sql).toContain("p.`status` = 'PENDING'");
    expect(sql).toContain("p.`payment_status` = 'PENDING'");
    expect(sql).toContain('p.`paid_at` IS NULL');
    expect(sql).toContain('p.`voided_at` IS NULL');
    expect(sql).toContain("p.`status` = 'FULFILLED'");
    expect(sql).toContain("p.`payment_status` = 'SUCCEEDED'");
    expect(sql).toContain('p.`paid_at` IS NOT NULL');
    expect(sql).toContain("p.`status` = 'VOIDED'");
    expect(sql).toContain("p.`payment_status` = 'REVERSED'");
    expect(sql).toContain('p.`voided_at` IS NOT NULL');
    expect(sql).toMatch(/PENDING[\s\S]*membership_count`?\s*=\s*0/);
  });

  it('backfills voided history and classifies only strict upgrades without creating renewals', async () => {
    const runner = successfulQueryRunner();

    await new MembershipEntitlementSegments1718000000005().up(runner as never);

    const insert = statements(runner.query).find((statement) =>
      statement.startsWith('INSERT INTO `membership_entitlement_segments`'),
    );
    expect(insert).toBeDefined();
    expect(insert).toContain("p.`status` IN ('FULFILLED','VOIDED')");
    expect(insert).toContain("p.`payment_status` IN ('SUCCEEDED','REVERSED')");
    expect(insert).toContain('p.`paid_at` IS NOT NULL');
    expect(insert).toContain('previous.`user_id` = membership.`user_id`');
    expect(insert).toContain('membership.`level_rank` > previous.`level_rank`');
    expect(insert).toContain('membership.`starts_at` = p.`paid_at`');
    expect(insert).toContain('previous.`starts_at` <= p.`paid_at`');
    expect(insert).toContain('previous.`ends_at` > p.`paid_at`');
    expect(insert).toContain(
      `THEN '${MembershipEntitlementSegmentKind.UPGRADE}'`,
    );
    expect(insert).toContain(
      `ELSE '${MembershipEntitlementSegmentKind.INITIAL}'`,
    );
    expect(insert).not.toContain(
      `THEN '${MembershipEntitlementSegmentKind.RENEWAL}'`,
    );
  });

  it.each(['backfill', 'postflight'])(
    'drops the created table when %s fails after MySQL DDL implicit commit',
    async (stage) => {
      const query = vi.fn(async (sql: string) => {
        if (stage === 'backfill' && sql.startsWith('INSERT INTO')) {
          throw new Error('forced backfill failure');
        }
        if (stage === 'postflight' && sql.includes('postflight:')) {
          return [{ id: '77' }];
        }
        return [];
      });

      await expect(
        new MembershipEntitlementSegments1718000000005().up({ query } as never),
      ).rejects.toThrow(
        stage === 'backfill' ? 'forced backfill failure' : /postflight.*77/i,
      );
      expect(statements(query).at(-1)).toBe(
        'DROP TABLE IF EXISTS `membership_entitlement_segments`',
      );
    },
  );

  it('checks postflight coverage, kind restoration fields, and unchanged memberships', async () => {
    const runner = successfulQueryRunner();

    await new MembershipEntitlementSegments1718000000005().up(runner as never);

    const sql = statements(runner.query).join('\n');
    expect(sql).toContain('postflight:fulfilled-segment-cardinality');
    expect(sql).toContain('postflight:pending-with-segment');
    expect(sql).toContain('postflight:segment-shape');
    expect(sql).toContain('postflight:membership-unchanged');
  });

  it('refuses down when a renewal would lose its only restore provenance', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('down-guard:renewal') ? [{ id: '81' }] : [],
    );

    await expect(
      new MembershipEntitlementSegments1718000000005().down({ query } as never),
    ).rejects.toThrow(/cannot.*lossless.*RENEWAL.*81/i);
    expect(statements(query)).not.toContain(
      'DROP TABLE `membership_entitlement_segments`',
    );
  });

  it('refuses down when an upgrade stores a later pre-truncation end time', async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes('down-guard:truncated-upgrade') ? [{ id: '82' }] : [],
    );

    await expect(
      new MembershipEntitlementSegments1718000000005().down({ query } as never),
    ).rejects.toThrow(/cannot.*lossless.*UPGRADE.*82/i);
    expect(statements(query)).not.toContain(
      'DROP TABLE `membership_entitlement_segments`',
    );
  });

  it('checks RENEWAL before truncated UPGRADE and drops only when both guards pass', async () => {
    const runner = successfulQueryRunner();

    await new MembershipEntitlementSegments1718000000005().down(
      runner as never,
    );

    const sql = statements(runner.query);
    const renewal = sql.findIndex((statement) =>
      statement.includes('down-guard:renewal'),
    );
    const upgrade = sql.findIndex((statement) =>
      statement.includes('down-guard:truncated-upgrade'),
    );
    const drop = sql.findIndex(
      (statement) =>
        statement === 'DROP TABLE `membership_entitlement_segments`',
    );
    expect(renewal).toBeGreaterThanOrEqual(0);
    expect(upgrade).toBeGreaterThan(renewal);
    expect(drop).toBeGreaterThan(upgrade);
  });

  it('registers the migration and entity in every runtime boundary', () => {
    const dataSource = source('apps/api/src/database/data-source.ts');
    const databaseModule = source('apps/api/src/database/database.module.ts');
    const entityIndex = source('apps/api/src/database/entities/index.ts');
    const membershipModule = source(
      'apps/api/src/membership/membership.module.ts',
    );
    const migrationName = 'MembershipEntitlementSegments1718000000005';
    const entityName = 'MembershipEntitlementSegment';

    for (const runtimeSource of [dataSource, databaseModule]) {
      expect(runtimeSource).toContain(migrationName);
    }
    expect(entityIndex).toContain(entityName);
    expect(membershipModule).toContain(entityName);
  });
});
