import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { MembershipEntitlementSegmentKind } from '@bake-mall/contracts';
import { DataSource, type MigrationInterface } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as entities from '../src/database/entities/index.js';
import { InitialSchema1718000000000 } from '../src/database/migrations/0001-initial-schema.js';
import { ProductSortOrder1718000000001 } from '../src/database/migrations/0002-product-sort-order.js';
import { Task12AdminMediaAndOrderIndexes1718000000002 } from '../src/database/migrations/0003-task12-admin-media-and-order-indexes.js';
import { SkuStockVersion1718000000003 } from '../src/database/migrations/0004-sku-stock-version.js';
import { MembershipAndOrderPricing1718000000004 } from '../src/database/migrations/0005-membership-and-order-pricing.js';
import { MembershipEntitlementSegments1718000000005 } from '../src/database/migrations/0006-membership-entitlement-segments.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
  type RootSqlExecutor,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_membership_segments_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const LEGACY_MIGRATIONS = [
  InitialSchema1718000000000,
  ProductSortOrder1718000000001,
  Task12AdminMediaAndOrderIndexes1718000000002,
  SkuStockVersion1718000000003,
  MembershipAndOrderPricing1718000000004,
];
const ALL_MIGRATIONS = [
  ...LEGACY_MIGRATIONS,
  MembershipEntitlementSegments1718000000005,
];

type FixtureIds = {
  firstMembership: string;
  oldSameLevelMembership: string;
  expiredReopenMembership: string;
  upgradePreviousMembership: string;
  upgradeMembership: string;
  voidedMembership: string;
  pendingPurchase: string;
  renewalUser: string;
  lowLevel: string;
};

type SegmentRow = {
  membership_id: string;
  purchase_order_id: string;
  kind: MembershipEntitlementSegmentKind;
  starts_at: Date;
  ends_at: Date;
  previous_membership_id: string | null;
  previous_membership_ends_at: Date | null;
};

function dataSource(
  migrations: Array<new () => MigrationInterface>,
  databaseName = DATABASE_NAME,
): DataSource {
  return new DataSource({
    type: 'mysql',
    host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_MYSQL_PORT ?? 3306),
    database: databaseName,
    username: APP_USER,
    password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
    charset: 'utf8mb4',
    timezone: 'Z',
    synchronize: false,
    entities: Object.values(entities),
    migrations,
    migrationsTableName: 'migrations',
  });
}

function insertId(result: { insertId: string | number }): string {
  return String(result.insertId);
}

async function insertUser(source: DataSource, phone: string): Promise<string> {
  return insertId(
    await source.query(
      'INSERT INTO `users` (`phone`, `phone_verified`) VALUES (?, 1)',
      [phone],
    ),
  );
}

async function insertLevel(
  source: DataSource,
  code: string,
  rank: number,
): Promise<string> {
  return insertId(
    await source.query(
      `INSERT INTO \`membership_levels\`
        (\`code\`, \`name\`, \`rank\`, \`price_cents\`, \`grant_credit_cents\`,
         \`discount_basis_points\`, \`valid_days\`, \`benefits\`, \`theme\`,
         \`badge_text\`, \`is_active\`)
       VALUES (?, ?, ?, 10000, 1000, 9500, 30, JSON_ARRAY(JSON_OBJECT('title', ?)),
               'PEARL', ?, 1)`,
      [code, `${code} level`, rank, `${code} benefit`, code],
    ),
  );
}

type PurchaseInput = {
  userId: string;
  levelId: string;
  levelCode: string;
  levelRank: number;
  status: 'PENDING' | 'FULFILLED' | 'VOIDED';
  paymentStatus: 'PENDING' | 'SUCCEEDED' | 'REVERSED';
  paidAt: string | null;
  voidedAt?: string | null;
};

async function insertPurchase(
  source: DataSource,
  input: PurchaseInput,
): Promise<string> {
  const token = randomUUID().replaceAll('-', '');
  return insertId(
    await source.query(
      `INSERT INTO \`membership_purchase_orders\`
        (\`purchase_no\`, \`user_id\`, \`membership_level_id\`, \`level_code\`,
         \`level_name\`, \`level_rank\`, \`price_cents\`, \`grant_credit_cents\`,
         \`discount_basis_points\`, \`valid_days\`, \`benefits\`, \`theme\`,
         \`badge_text\`, \`status\`, \`payment_status\`, \`payment_channel\`,
         \`idempotency_key\`, \`request_hash\`, \`paid_at\`, \`voided_at\`)
       VALUES (?, ?, ?, ?, ?, ?, 10000, 1000, 9500, 30,
               JSON_ARRAY(JSON_OBJECT('title', ?)), 'PEARL', ?, ?, ?, 'SIMULATED',
               ?, ?, ?, ?)`,
      [
        `MP${token.slice(0, 20)}`,
        input.userId,
        input.levelId,
        input.levelCode,
        `${input.levelCode} level`,
        input.levelRank,
        `${input.levelCode} benefit`,
        input.levelCode,
        input.status,
        input.paymentStatus,
        token,
        token.padEnd(64, '0'),
        input.paidAt,
        input.voidedAt ?? null,
      ],
    ),
  );
}

type MembershipInput = {
  userId: string;
  purchaseId: string;
  levelId: string;
  levelCode: string;
  levelRank: number;
  startsAt: string;
  endsAt: string;
  previousMembershipId?: string | null;
  status?: 'ACTIVE' | 'REPLACED' | 'VOIDED' | 'EXPIRED';
};

async function insertMembership(
  source: DataSource,
  input: MembershipInput,
): Promise<string> {
  return insertId(
    await source.query(
      `INSERT INTO \`user_memberships\`
        (\`user_id\`, \`purchase_order_id\`, \`membership_level_id\`, \`level_code\`,
         \`level_name\`, \`level_rank\`, \`discount_basis_points\`, \`benefits\`,
         \`theme\`, \`badge_text\`, \`starts_at\`, \`ends_at\`,
         \`previous_membership_id\`, \`status\`)
       VALUES (?, ?, ?, ?, ?, ?, 9500, JSON_ARRAY(JSON_OBJECT('title', ?)),
               'PEARL', ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.purchaseId,
        input.levelId,
        input.levelCode,
        `${input.levelCode} level`,
        input.levelRank,
        `${input.levelCode} benefit`,
        input.levelCode,
        input.startsAt,
        input.endsAt,
        input.previousMembershipId ?? null,
        input.status ?? 'ACTIVE',
      ],
    ),
  );
}

async function createFixtures(source: DataSource): Promise<FixtureIds> {
  const [lowLevel, highLevel] = await Promise.all([
    insertLevel(source, 'LOW', 10),
    insertLevel(source, 'HIGH', 20),
  ]);
  const [renewalUser, reopenUser, upgradeUser, voidedUser, pendingUser] =
    await Promise.all(
      [
        '13910000001',
        '13910000002',
        '13910000003',
        '13910000004',
        '13910000005',
      ].map((phone) => insertUser(source, phone)),
    );

  const firstPurchase = await insertPurchase(source, {
    userId: renewalUser,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    status: 'FULFILLED',
    paymentStatus: 'SUCCEEDED',
    paidAt: '2026-01-01 00:00:00',
  });
  const firstMembership = await insertMembership(source, {
    userId: renewalUser,
    purchaseId: firstPurchase,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    startsAt: '2026-01-01 00:00:00',
    endsAt: '2026-02-01 00:00:00',
    status: 'REPLACED',
  });
  const sameLevelPurchase = await insertPurchase(source, {
    userId: renewalUser,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    status: 'FULFILLED',
    paymentStatus: 'SUCCEEDED',
    paidAt: '2026-01-20 00:00:00',
  });
  const oldSameLevelMembership = await insertMembership(source, {
    userId: renewalUser,
    purchaseId: sameLevelPurchase,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    startsAt: '2026-02-01 00:00:00',
    endsAt: '2026-03-01 00:00:00',
    previousMembershipId: firstMembership,
  });

  const expiredBasePurchase = await insertPurchase(source, {
    userId: reopenUser,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    status: 'FULFILLED',
    paymentStatus: 'SUCCEEDED',
    paidAt: '2025-11-01 00:00:00',
  });
  const expiredBaseMembership = await insertMembership(source, {
    userId: reopenUser,
    purchaseId: expiredBasePurchase,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    startsAt: '2025-11-01 00:00:00',
    endsAt: '2025-12-01 00:00:00',
    status: 'EXPIRED',
  });
  const reopenPurchase = await insertPurchase(source, {
    userId: reopenUser,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    status: 'FULFILLED',
    paymentStatus: 'SUCCEEDED',
    paidAt: '2026-02-01 00:00:00',
  });
  const expiredReopenMembership = await insertMembership(source, {
    userId: reopenUser,
    purchaseId: reopenPurchase,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    startsAt: '2026-02-01 00:00:00',
    endsAt: '2026-03-01 00:00:00',
    previousMembershipId: expiredBaseMembership,
  });

  const upgradeBasePurchase = await insertPurchase(source, {
    userId: upgradeUser,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    status: 'FULFILLED',
    paymentStatus: 'SUCCEEDED',
    paidAt: '2026-03-01 00:00:00',
  });
  const upgradePreviousMembership = await insertMembership(source, {
    userId: upgradeUser,
    purchaseId: upgradeBasePurchase,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    startsAt: '2026-03-01 00:00:00',
    endsAt: '2026-05-01 00:00:00',
    status: 'REPLACED',
  });
  const upgradePurchase = await insertPurchase(source, {
    userId: upgradeUser,
    levelId: highLevel,
    levelCode: 'HIGH',
    levelRank: 20,
    status: 'FULFILLED',
    paymentStatus: 'SUCCEEDED',
    paidAt: '2026-04-01 00:00:00',
  });
  const upgradeMembership = await insertMembership(source, {
    userId: upgradeUser,
    purchaseId: upgradePurchase,
    levelId: highLevel,
    levelCode: 'HIGH',
    levelRank: 20,
    startsAt: '2026-04-01 00:00:00',
    endsAt: '2026-05-01 00:00:00',
    previousMembershipId: upgradePreviousMembership,
  });

  const voidedPurchase = await insertPurchase(source, {
    userId: voidedUser,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    status: 'VOIDED',
    paymentStatus: 'REVERSED',
    paidAt: '2026-05-01 00:00:00',
    voidedAt: '2026-05-02 00:00:00',
  });
  const voidedMembership = await insertMembership(source, {
    userId: voidedUser,
    purchaseId: voidedPurchase,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    startsAt: '2026-05-01 00:00:00',
    endsAt: '2026-06-01 00:00:00',
    status: 'VOIDED',
  });
  const pendingPurchase = await insertPurchase(source, {
    userId: pendingUser,
    levelId: lowLevel,
    levelCode: 'LOW',
    levelRank: 10,
    status: 'PENDING',
    paymentStatus: 'PENDING',
    paidAt: null,
  });

  return {
    firstMembership,
    oldSameLevelMembership,
    expiredReopenMembership,
    upgradePreviousMembership,
    upgradeMembership,
    voidedMembership,
    pendingPurchase,
    renewalUser,
    lowLevel,
  };
}

async function tableCount(
  source: DataSource,
  table: string,
  databaseName = DATABASE_NAME,
): Promise<number> {
  const rows = (await source.query(
    `SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`,
    [databaseName, table],
  )) as Array<{ count: string | number }>;
  return Number(rows[0]?.count ?? 0);
}

async function migrationCount(source: DataSource): Promise<number> {
  const rows = (await source.query(
    "SELECT COUNT(*) AS count FROM `migrations` WHERE `name`='MembershipEntitlementSegments1718000000005'",
  )) as Array<{ count: string | number }>;
  return Number(rows[0]?.count ?? 0);
}

type PreflightFailureCase = {
  category: 'membership-period' | 'voided-time-order';
  phone: string;
  purchaseStatus: 'FULFILLED' | 'VOIDED';
  paymentStatus: 'SUCCEEDED' | 'REVERSED';
  paidAt: string;
  voidedAt: string | null;
  membershipStartsAt: string;
  membershipEndsAt: string;
};

async function assertRealMysqlPreflightFailure(
  rootSql: RootSqlExecutor,
  input: PreflightFailureCase,
): Promise<void> {
  const databaseName = `bake_mall_membership_preflight_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const options = { databaseName, appUser: APP_USER };
  let cleanupDatabase: (() => void) | undefined;
  let legacy: DataSource | undefined;
  let source: DataSource | undefined;

  try {
    cleanupDatabase = provisionMysqlTestDatabase(rootSql, options);
    legacy = dataSource(LEGACY_MIGRATIONS, databaseName);
    await legacy.initialize();
    await legacy.runMigrations({ transaction: 'none' });
    const userId = await insertUser(legacy, input.phone);
    const levelId = await insertLevel(legacy, 'PREFLIGHT', 10);
    const purchaseId = await insertPurchase(legacy, {
      userId,
      levelId,
      levelCode: 'PREFLIGHT',
      levelRank: 10,
      status: input.purchaseStatus,
      paymentStatus: input.paymentStatus,
      paidAt: input.paidAt,
      voidedAt: input.voidedAt,
    });
    const membershipId = await insertMembership(legacy, {
      userId,
      purchaseId,
      levelId,
      levelCode: 'PREFLIGHT',
      levelRank: 10,
      startsAt: input.membershipStartsAt,
      endsAt: input.membershipEndsAt,
      status: input.purchaseStatus === 'VOIDED' ? 'VOIDED' : 'ACTIVE',
    });
    if (input.category === 'membership-period') {
      rootSql(
        `ALTER TABLE \`${databaseName}\` .\`user_memberships\` DROP CHECK \`chk_user_memberships_period\``,
      );
      await legacy.query(
        'UPDATE `user_memberships` SET `ends_at`=`starts_at` WHERE `id`=?',
        [membershipId],
      );
    }
    await legacy.destroy();
    legacy = undefined;

    source = dataSource(ALL_MIGRATIONS, databaseName);
    await source.initialize();
    await expect(source.runMigrations({ transaction: 'none' })).rejects.toThrow(
      new RegExp(
        `preflight:${input.category}.*${purchaseId}|preflight:${input.category}.*${membershipId}`,
        'i',
      ),
    );
    expect(
      await tableCount(source, 'membership_entitlement_segments', databaseName),
    ).toBe(0);
    expect(await migrationCount(source)).toBe(0);
  } finally {
    try {
      if (source?.isInitialized) await source.destroy();
    } finally {
      source = undefined;
      try {
        if (legacy?.isInitialized) await legacy.destroy();
      } finally {
        legacy = undefined;
        cleanupDatabase?.();
        cleanupDatabase = undefined;
      }
    }
  }
}

describe.sequential(
  '0006 membership entitlement migration preflight on real MySQL',
  () => {
    const rootSql = createDockerRootSqlExecutor();

    it('rejects an invalid legacy membership period before creating the segment table', async () => {
      await assertRealMysqlPreflightFailure(rootSql, {
        category: 'membership-period',
        phone: `13920000001${process.pid}`,
        purchaseStatus: 'FULFILLED',
        paymentStatus: 'SUCCEEDED',
        paidAt: '2026-01-01 00:00:00',
        voidedAt: null,
        membershipStartsAt: '2026-01-01 00:00:00',
        membershipEndsAt: '2026-02-01 00:00:00',
      });
    }, 60_000);

    it('rejects a reversed purchase voided before paid before creating the segment table', async () => {
      await assertRealMysqlPreflightFailure(rootSql, {
        category: 'voided-time-order',
        phone: `13920000002${process.pid}`,
        purchaseStatus: 'VOIDED',
        paymentStatus: 'REVERSED',
        paidAt: '2026-05-02 00:00:00',
        voidedAt: '2026-05-01 00:00:00',
        membershipStartsAt: '2026-05-02 00:00:00',
        membershipEndsAt: '2026-06-01 00:00:00',
      });
    }, 60_000);
  },
);

describe.sequential(
  '0006 membership entitlement migration on real MySQL',
  () => {
    const rootSql = createDockerRootSqlExecutor();
    let cleanupDatabase: (() => void) | undefined;
    let legacy: DataSource | undefined;
    let source: DataSource | undefined;
    let fixtureIds: FixtureIds;
    let membershipSnapshot: unknown[];

    beforeAll(async () => {
      try {
        cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
        legacy = dataSource(LEGACY_MIGRATIONS);
        await legacy.initialize();
        await legacy.runMigrations({ transaction: 'none' });
        fixtureIds = await createFixtures(legacy);
        membershipSnapshot = await legacy.query(
          'SELECT * FROM `user_memberships` ORDER BY `id`',
        );
        await legacy.destroy();
        legacy = undefined;

        source = dataSource(ALL_MIGRATIONS);
        await source.initialize();
        const executed = await source.runMigrations({ transaction: 'none' });
        expect(executed.map(({ name }) => name)).toEqual([
          'MembershipEntitlementSegments1718000000005',
        ]);
      } catch (error) {
        try {
          if (source?.isInitialized) await source.destroy();
        } finally {
          source = undefined;
          try {
            if (legacy?.isInitialized) await legacy.destroy();
          } finally {
            legacy = undefined;
            cleanupDatabase?.();
            cleanupDatabase = undefined;
          }
        }
        throw error;
      }
    }, 60_000);

    afterAll(async () => {
      try {
        if (source?.isInitialized) await source.destroy();
      } finally {
        source = undefined;
        try {
          if (legacy?.isInitialized) await legacy.destroy();
        } finally {
          legacy = undefined;
          cleanupDatabase?.();
          cleanupDatabase = undefined;
        }
      }
      expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
        schemaCount: 0,
        grantCount: 0,
      });
    });

    it('backfills all fulfilled and voided purchases without changing legacy memberships', async () => {
      if (!source) throw new Error('Temporary data source is unavailable');
      const segments = (await source.query(
        'SELECT * FROM `membership_entitlement_segments` ORDER BY `id`',
      )) as SegmentRow[];
      const fulfilledCount = Number(
        (
          (await source.query(
            "SELECT COUNT(*) AS count FROM `membership_purchase_orders` WHERE (`status`='FULFILLED' AND `payment_status`='SUCCEEDED') OR (`status`='VOIDED' AND `payment_status`='REVERSED')",
          )) as Array<{ count: string | number }>
        )[0].count,
      );
      expect(segments).toHaveLength(fulfilledCount);
      expect(
        segments.find(
          ({ membership_id }) => membership_id === fixtureIds.voidedMembership,
        ),
      ).toBeDefined();
      expect(
        await source.query('SELECT * FROM `user_memberships` ORDER BY `id`'),
      ).toEqual(membershipSnapshot);
    });

    it('classifies first, old same-level renewal, and expired reopen as INITIAL only', async () => {
      if (!source) throw new Error('Temporary data source is unavailable');
      const rows = (await source.query(
        'SELECT `membership_id`, `kind`, `previous_membership_id`, `previous_membership_ends_at` FROM `membership_entitlement_segments` WHERE `membership_id` IN (?, ?, ?)',
        [
          fixtureIds.firstMembership,
          fixtureIds.oldSameLevelMembership,
          fixtureIds.expiredReopenMembership,
        ],
      )) as SegmentRow[];
      expect(rows).toHaveLength(3);
      expect(
        rows.every(
          ({ kind }) => kind === MembershipEntitlementSegmentKind.INITIAL,
        ),
      ).toBe(true);
      expect(
        rows.every(
          ({ previous_membership_id }) => previous_membership_id === null,
        ),
      ).toBe(true);
      expect(
        rows.every(
          ({ previous_membership_ends_at }) =>
            previous_membership_ends_at === null,
        ),
      ).toBe(true);
      const renewalCount = await source.query(
        "SELECT COUNT(*) AS count FROM `membership_entitlement_segments` WHERE `kind`='RENEWAL'",
      );
      expect(Number(renewalCount[0].count)).toBe(0);
    });

    it('classifies the strict upgrade and saves the previous membership original end', async () => {
      if (!source) throw new Error('Temporary data source is unavailable');
      const [segment] = (await source.query(
        'SELECT * FROM `membership_entitlement_segments` WHERE `membership_id`=?',
        [fixtureIds.upgradeMembership],
      )) as SegmentRow[];
      expect(segment).toMatchObject({
        kind: MembershipEntitlementSegmentKind.UPGRADE,
        previous_membership_id: fixtureIds.upgradePreviousMembership,
      });
      expect(segment.previous_membership_ends_at).toEqual(
        new Date('2026-05-01T00:00:00.000Z'),
      );
    });

    it('uses RESTRICT for the previous membership FK and CASCADE for direct sources', async () => {
      if (!source) throw new Error('Temporary data source is unavailable');
      const rows = (await source.query(
        `SELECT CONSTRAINT_NAME, UPDATE_RULE
       FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA=?
         AND TABLE_NAME='membership_entitlement_segments'
       ORDER BY CONSTRAINT_NAME`,
        [DATABASE_NAME],
      )) as Array<{ CONSTRAINT_NAME: string; UPDATE_RULE: string }>;
      expect(rows).toEqual([
        {
          CONSTRAINT_NAME: 'fk_membership_entitlement_segments_membership',
          UPDATE_RULE: 'CASCADE',
        },
        {
          CONSTRAINT_NAME: 'fk_membership_entitlement_segments_previous',
          UPDATE_RULE: 'RESTRICT',
        },
        {
          CONSTRAINT_NAME: 'fk_membership_entitlement_segments_purchase',
          UPDATE_RULE: 'CASCADE',
        },
      ]);
    });

    it('does not backfill PENDING and reports no pending migration on the second run', async () => {
      if (!source) throw new Error('Temporary data source is unavailable');
      const pendingSegments = await source.query(
        'SELECT COUNT(*) AS count FROM `membership_entitlement_segments` WHERE `purchase_order_id`=?',
        [fixtureIds.pendingPurchase],
      );
      expect(Number(pendingSegments[0].count)).toBe(0);
      await expect(
        source.runMigrations({ transaction: 'none' }),
      ).resolves.toEqual([]);
    });

    it('enforces real CHECK, FK, and purchase uniqueness while allowing a renewal to target an existing membership', async () => {
      if (!source) throw new Error('Temporary data source is unavailable');
      const renewalPurchase = await insertPurchase(source, {
        userId: fixtureIds.renewalUser,
        levelId: fixtureIds.lowLevel,
        levelCode: 'LOW',
        levelRank: 10,
        status: 'FULFILLED',
        paymentStatus: 'SUCCEEDED',
        paidAt: '2026-03-01 00:00:00',
      });
      await source.query(
        `INSERT INTO \`membership_entitlement_segments\`
        (\`membership_id\`, \`purchase_order_id\`, \`kind\`, \`starts_at\`, \`ends_at\`)
       VALUES (?, ?, 'RENEWAL', '2026-03-01 00:00:00', '2026-04-01 00:00:00')`,
        [fixtureIds.oldSameLevelMembership, renewalPurchase],
      );
      await expect(
        source.query(
          `INSERT INTO \`membership_entitlement_segments\`
          (\`membership_id\`, \`purchase_order_id\`, \`kind\`, \`starts_at\`, \`ends_at\`)
         VALUES (?, ?, 'INITIAL', '2026-04-01 00:00:00', '2026-04-01 00:00:00')`,
          [fixtureIds.oldSameLevelMembership, fixtureIds.pendingPurchase],
        ),
      ).rejects.toBeDefined();
      await expect(
        source.query(
          `INSERT INTO \`membership_entitlement_segments\`
          (\`membership_id\`, \`purchase_order_id\`, \`kind\`, \`starts_at\`, \`ends_at\`,
           \`previous_membership_id\`, \`previous_membership_ends_at\`)
         VALUES (?, ?, 'INITIAL', '2026-04-01 00:00:00', '2026-05-01 00:00:00', ?, '2026-03-01 00:00:00')`,
          [
            fixtureIds.oldSameLevelMembership,
            fixtureIds.pendingPurchase,
            fixtureIds.firstMembership,
          ],
        ),
      ).rejects.toBeDefined();
      await expect(
        source.query(
          `INSERT INTO \`membership_entitlement_segments\`
          (\`membership_id\`, \`purchase_order_id\`, \`kind\`, \`starts_at\`, \`ends_at\`)
         VALUES (999999999999, ?, 'INITIAL', '2026-04-01 00:00:00', '2026-05-01 00:00:00')`,
          [fixtureIds.pendingPurchase],
        ),
      ).rejects.toBeDefined();
      await expect(
        source.query(
          `INSERT INTO \`membership_entitlement_segments\`
          (\`membership_id\`, \`purchase_order_id\`, \`kind\`, \`starts_at\`, \`ends_at\`)
         VALUES (?, ?, 'INITIAL', '2026-04-01 00:00:00', '2026-05-01 00:00:00')`,
          [fixtureIds.firstMembership, renewalPurchase],
        ),
      ).rejects.toBeDefined();
      await source.query(
        'DELETE FROM `membership_entitlement_segments` WHERE `purchase_order_id`=?',
        [renewalPurchase],
      );
      await source.query(
        'DELETE FROM `membership_purchase_orders` WHERE `id`=?',
        [renewalPurchase],
      );
    });

    it('reverts pure historical backfill successfully and can migrate forward again', async () => {
      if (!source) throw new Error('Temporary data source is unavailable');
      await source.undoLastMigration({ transaction: 'none' });
      expect(await tableCount(source, 'membership_entitlement_segments')).toBe(
        0,
      );
      expect(await migrationCount(source)).toBe(0);
      const executed = await source.runMigrations({ transaction: 'none' });
      expect(executed.map(({ name }) => name)).toEqual([
        'MembershipEntitlementSegments1718000000005',
      ]);
    });

    it('keeps the table and TypeORM migration record when a new RENEWAL blocks revert', async () => {
      if (!source) throw new Error('Temporary data source is unavailable');
      const renewalPurchase = await insertPurchase(source, {
        userId: fixtureIds.renewalUser,
        levelId: fixtureIds.lowLevel,
        levelCode: 'LOW',
        levelRank: 10,
        status: 'FULFILLED',
        paymentStatus: 'SUCCEEDED',
        paidAt: '2026-03-01 00:00:00',
      });
      await source.query(
        `INSERT INTO \`membership_entitlement_segments\`
        (\`membership_id\`, \`purchase_order_id\`, \`kind\`, \`starts_at\`, \`ends_at\`)
       VALUES (?, ?, 'RENEWAL', '2026-03-01 00:00:00', '2026-04-01 00:00:00')`,
        [fixtureIds.oldSameLevelMembership, renewalPurchase],
      );

      await expect(
        source.undoLastMigration({ transaction: 'none' }),
      ).rejects.toThrow(/cannot.*lossless.*RENEWAL/i);
      expect(await tableCount(source, 'membership_entitlement_segments')).toBe(
        1,
      );
      expect(await migrationCount(source)).toBe(1);

      await source.query(
        'DELETE FROM `membership_entitlement_segments` WHERE `purchase_order_id`=?',
        [renewalPurchase],
      );
      await source.query(
        'DELETE FROM `membership_purchase_orders` WHERE `id`=?',
        [renewalPurchase],
      );
    });

    it('keeps the table and TypeORM migration record when truncated UPGRADE blocks revert', async () => {
      if (!source) throw new Error('Temporary data source is unavailable');
      await source.query(
        "UPDATE `user_memberships` SET `ends_at`='2026-04-01 00:00:00' WHERE `id`=?",
        [fixtureIds.upgradePreviousMembership],
      );

      await expect(
        source.undoLastMigration({ transaction: 'none' }),
      ).rejects.toThrow(/cannot.*lossless.*UPGRADE/i);
      expect(await tableCount(source, 'membership_entitlement_segments')).toBe(
        1,
      );
      expect(await migrationCount(source)).toBe(1);

      await source.query(
        "UPDATE `user_memberships` SET `ends_at`='2026-05-01 00:00:00' WHERE `id`=?",
        [fixtureIds.upgradePreviousMembership],
      );
    });
  },
);
