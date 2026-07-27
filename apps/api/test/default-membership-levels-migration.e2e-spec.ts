import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { DataSource, type MigrationInterface } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as entities from '../src/database/entities/index.js';
import { InitialSchema1718000000000 } from '../src/database/migrations/0001-initial-schema.js';
import { ProductSortOrder1718000000001 } from '../src/database/migrations/0002-product-sort-order.js';
import { Task12AdminMediaAndOrderIndexes1718000000002 } from '../src/database/migrations/0003-task12-admin-media-and-order-indexes.js';
import { SkuStockVersion1718000000003 } from '../src/database/migrations/0004-sku-stock-version.js';
import { MembershipAndOrderPricing1718000000004 } from '../src/database/migrations/0005-membership-and-order-pricing.js';
import { MembershipEntitlementSegments1718000000005 } from '../src/database/migrations/0006-membership-entitlement-segments.js';
import { DefaultMembershipLevels1718000000006 } from '../src/database/migrations/0007-default-membership-levels.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_default_levels_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const MIGRATIONS: Array<new () => MigrationInterface> = [
  InitialSchema1718000000000,
  ProductSortOrder1718000000001,
  Task12AdminMediaAndOrderIndexes1718000000002,
  SkuStockVersion1718000000003,
  MembershipAndOrderPricing1718000000004,
  MembershipEntitlementSegments1718000000005,
  DefaultMembershipLevels1718000000006,
];

type BenefitRow = {
  title: string;
  description?: string;
  sortOrder: number;
};

type LevelRow = {
  code: string;
  name: string;
  subtitle: string;
  description: string;
  rank: number;
  price_cents: number;
  grant_credit_cents: number;
  discount_basis_points: number;
  valid_days: number;
  benefits: string | BenefitRow[];
  theme: string;
  badge_text: string;
  sort_order: number;
  is_active: number;
  version: number;
};

function dataSource(): DataSource {
  return new DataSource({
    type: 'mysql',
    host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_MYSQL_PORT ?? 3306),
    database: DATABASE_NAME,
    username: APP_USER,
    password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
    charset: 'utf8mb4',
    timezone: 'Z',
    synchronize: false,
    entities: Object.values(entities),
    migrations: MIGRATIONS,
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
  });
}

function parseBenefits(value: LevelRow['benefits']): BenefitRow[] {
  return typeof value === 'string'
    ? (JSON.parse(value) as BenefitRow[])
    : value;
}

async function readLevels(source: DataSource): Promise<LevelRow[]> {
  return source.query(
    `SELECT
       \`code\`, \`name\`, \`subtitle\`, \`description\`, \`rank\`,
       \`price_cents\`, \`grant_credit_cents\`,
       \`discount_basis_points\`, \`valid_days\`, \`benefits\`, \`theme\`,
       \`badge_text\`, \`sort_order\`, \`is_active\`, \`version\`
     FROM \`membership_levels\`
     ORDER BY \`sort_order\` ASC, \`id\` ASC`,
  );
}

describe.sequential('Default membership levels migration on MySQL', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let source: DataSource | undefined;

  beforeAll(async () => {
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      source = dataSource();
      await source.initialize();
      await source.runMigrations();
    } catch (error) {
      if (source?.isInitialized) await source.destroy();
      cleanupDatabase?.();
      cleanupDatabase = undefined;
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    try {
      if (source?.isInitialized) await source.destroy();
    } finally {
      cleanupDatabase?.();
      cleanupDatabase = undefined;
    }
    expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
      schemaCount: 0,
      grantCount: 0,
    });
  });

  it('rolls back every inserted level when a later default insert fails', async () => {
    await source!.undoLastMigration({ transaction: 'each' });
    const runner = source!.createQueryRunner();
    await runner.connect();
    const realQuery = runner.query.bind(runner);
    let insertCount = 0;
    runner.query = async <T = unknown>(
      sql: string,
      parameters?: unknown[],
    ): Promise<T> => {
      if (sql.includes('INSERT INTO `membership_levels`')) {
        insertCount += 1;
        if (insertCount === 2) {
          throw new Error('reject second default level for rollback test');
        }
      }
      return realQuery(sql, parameters) as Promise<T>;
    };

    try {
      await expect(
        new DefaultMembershipLevels1718000000006().up(runner),
      ).rejects.toThrow(/reject second default level/);
      await expect(readLevels(source!)).resolves.toEqual([]);
    } finally {
      await runner.release();
    }

    await source!.runMigrations();
  });

  it('persists the four exact active levels and valid benefit JSON', async () => {
    const levels = await readLevels(source!);

    expect(
      levels.map(
        ({
          code,
          rank,
          price_cents,
          grant_credit_cents,
          discount_basis_points,
          valid_days,
          theme,
          badge_text,
          sort_order,
          is_active,
          version,
        }) => ({
          code,
          rank,
          priceCents: price_cents,
          grantCreditCents: grant_credit_cents,
          discountBasisPoints: discount_basis_points,
          validDays: valid_days,
          theme,
          badgeText: badge_text,
          sortOrder: sort_order,
          isActive: is_active,
          version,
        }),
      ),
    ).toEqual([
      {
        code: 'SILVER',
        rank: 10,
        priceCents: 9900,
        grantCreditCents: 1000,
        discountBasisPoints: 9500,
        validDays: 365,
        theme: 'PEARL',
        badgeText: 'SILVER',
        sortOrder: 10,
        isActive: 1,
        version: 1,
      },
      {
        code: 'GOLD',
        rank: 20,
        priceCents: 19900,
        grantCreditCents: 3000,
        discountBasisPoints: 9000,
        validDays: 365,
        theme: 'CHAMPAGNE',
        badgeText: 'GOLD',
        sortOrder: 20,
        isActive: 1,
        version: 1,
      },
      {
        code: 'DIAMOND',
        rank: 30,
        priceCents: 39900,
        grantCreditCents: 8000,
        discountBasisPoints: 8500,
        validDays: 365,
        theme: 'JADE',
        badgeText: 'DIAMOND',
        sortOrder: 30,
        isActive: 1,
        version: 1,
      },
      {
        code: 'BLACK',
        rank: 40,
        priceCents: 69900,
        grantCreditCents: 16000,
        discountBasisPoints: 8000,
        validDays: 365,
        theme: 'OBSIDIAN',
        badgeText: 'BLACK',
        sortOrder: 40,
        isActive: 1,
        version: 1,
      },
    ]);
    expect(
      levels.map(({ name, subtitle, description, benefits }) => ({
        name,
        subtitle,
        description,
        benefits: parseBenefits(benefits),
      })),
    ).toEqual([
      {
        name: '银卡',
        subtitle: '日常烘焙的轻盈礼遇',
        description: '享受会员折扣、开卡消费金与生日月专属祝福。',
        benefits: [
          {
            title: '全场商品 9.5 折',
            description: '会员有效期内，参与折扣的烘焙商品享受 9.5 折。',
            sortOrder: 10,
          },
          {
            title: '开卡赠送 ¥10 消费金',
            description: '购卡成功后一次性发放，可用于商品订单抵扣。',
            sortOrder: 20,
          },
          {
            title: '生日月专属祝福卡',
            description: '生日月下单可备注领取门店手写祝福卡。',
            sortOrder: 30,
          },
        ],
      },
      {
        name: '金卡',
        subtitle: '让每次尝鲜都更从容',
        description: '获得更高折扣、更多消费金与新品活动优先权。',
        benefits: [
          {
            title: '全场商品 9 折',
            description: '会员有效期内，参与折扣的烘焙商品享受 9 折。',
            sortOrder: 10,
          },
          {
            title: '开卡赠送 ¥30 消费金',
            description: '购卡成功后一次性发放，可用于商品订单抵扣。',
            sortOrder: 20,
          },
          {
            title: '生日月赠送指定烘焙单品',
            description: '生日月可按门店当期活动领取指定烘焙单品。',
            sortOrder: 30,
          },
          {
            title: '新品试吃活动优先参与',
            description: '新品试吃开放时可优先报名参加。',
            sortOrder: 40,
          },
        ],
      },
      {
        name: '钻石卡',
        subtitle: '珍藏每一份甜蜜时刻',
        description: '享受进阶折扣、定制升级与节日新品优先预订。',
        benefits: [
          {
            title: '全场商品 8.5 折',
            description: '会员有效期内，参与折扣的烘焙商品享受 8.5 折。',
            sortOrder: 10,
          },
          {
            title: '开卡赠送 ¥80 消费金',
            description: '购卡成功后一次性发放，可用于商品订单抵扣。',
            sortOrder: 20,
          },
          {
            title: '生日月赠送定制蛋糕升级',
            description: '生日月订购定制蛋糕时可享受指定升级礼遇。',
            sortOrder: 30,
          },
          {
            title: '节日限定商品优先预订',
            description: '节日限定商品开放后可优先预订。',
            sortOrder: 40,
          },
          {
            title: '新品尝鲜活动专属邀请',
            description: '新品尝鲜活动开放时可获得专属邀请。',
            sortOrder: 50,
          },
        ],
      },
      {
        name: '黑卡',
        subtitle: '为重要时刻保留专属席位',
        description: '享受旗舰折扣、定制蛋糕礼遇与专属服务。',
        benefits: [
          {
            title: '全场商品 8 折',
            description: '会员有效期内，参与折扣的烘焙商品享受 8 折。',
            sortOrder: 10,
          },
          {
            title: '开卡赠送 ¥160 消费金',
            description: '购卡成功后一次性发放，可用于商品订单抵扣。',
            sortOrder: 20,
          },
          {
            title: '生日月专属定制蛋糕礼遇',
            description: '生日月订购定制蛋糕时可享受专属礼遇。',
            sortOrder: 30,
          },
          {
            title: '节日限定商品优先锁单',
            description: '节日限定商品开放后可优先锁定订单。',
            sortOrder: 40,
          },
          {
            title: '新品尝鲜与门店活动专属邀请',
            description: '新品尝鲜和门店会员活动开放时可获得专属邀请。',
            sortOrder: 50,
          },
          {
            title: '专属客服与定制需求优先响应',
            description: '定制需求和售后咨询可获得优先响应。',
            sortOrder: 60,
          },
        ],
      },
    ]);
  });

  it('keeps a merchant-customized matching code and rank on rerun', async () => {
    await source!.undoLastMigration();
    await source!.query(
      `INSERT INTO \`membership_levels\`
        (\`code\`, \`name\`, \`rank\`, \`price_cents\`, \`grant_credit_cents\`,
         \`discount_basis_points\`, \`valid_days\`, \`benefits\`, \`theme\`,
         \`badge_text\`, \`sort_order\`, \`is_active\`, \`version\`)
       VALUES ('GOLD', '商家定制金卡', 20, 12345, 678, 8800, 180,
               JSON_ARRAY(JSON_OBJECT('title', '定制权益', 'sortOrder', 10)),
               'JADE', 'CUSTOM', 99, 0, 7)`,
    );

    await source!.runMigrations();

    const levels = await readLevels(source!);
    expect(levels).toHaveLength(4);
    expect(levels.find(({ code }) => code === 'GOLD')).toMatchObject({
      name: '商家定制金卡',
      price_cents: 12345,
      theme: 'JADE',
      is_active: 0,
      version: 7,
    });
  });

  it('rejects down when a purchase references a default level and keeps all levels', async () => {
    const [{ id: levelId }] = (await source!.query(
      "SELECT `id` FROM `membership_levels` WHERE `code` = 'SILVER'",
    )) as Array<{ id: string }>;
    const { insertId: userId } = (await source!.query(
      "INSERT INTO `users` (`phone`, `phone_verified`) VALUES ('13900000077', 1)",
    )) as { insertId: string | number };
    await source!.query(
      `INSERT INTO \`membership_purchase_orders\`
        (\`purchase_no\`, \`user_id\`, \`membership_level_id\`, \`level_code\`,
         \`level_name\`, \`level_rank\`, \`price_cents\`, \`grant_credit_cents\`,
         \`discount_basis_points\`, \`valid_days\`, \`benefits\`, \`theme\`,
         \`badge_text\`, \`status\`, \`payment_status\`, \`idempotency_key\`,
         \`request_hash\`)
       SELECT 'MPDEFAULTLEVEL00000001', ?, \`id\`, \`code\`, \`name\`, \`rank\`,
              \`price_cents\`, \`grant_credit_cents\`, \`discount_basis_points\`,
              \`valid_days\`, \`benefits\`, \`theme\`, \`badge_text\`,
              'PENDING', 'PENDING', 'default-level-down-guard', ?
       FROM \`membership_levels\`
       WHERE \`id\` = ?`,
      [String(userId), 'd'.repeat(64), levelId],
    );

    await expect(source!.undoLastMigration()).rejects.toThrow(
      /membership_purchase_orders/,
    );
    await expect(readLevels(source!)).resolves.toHaveLength(4);
    await source!.query(
      "DELETE FROM `membership_purchase_orders` WHERE `purchase_no` = 'MPDEFAULTLEVEL00000001'",
    );
  });

  it('rejects down when only a membership references a default level', async () => {
    const { insertId: customLevelId } = (await source!.query(
      `INSERT INTO \`membership_levels\`
        (\`code\`, \`name\`, \`rank\`, \`price_cents\`, \`grant_credit_cents\`,
         \`discount_basis_points\`, \`valid_days\`, \`benefits\`, \`theme\`,
         \`badge_text\`, \`sort_order\`, \`is_active\`, \`version\`)
       VALUES ('CUSTOM', '自定义卡', 90, 100, 0, 10000, 30, JSON_ARRAY(),
               'PEARL', 'CUSTOM', 90, 0, 1)`,
    )) as { insertId: string | number };
    const [{ id: defaultLevelId }] = (await source!.query(
      "SELECT `id` FROM `membership_levels` WHERE `code` = 'SILVER'",
    )) as Array<{ id: string }>;
    const { insertId: userId } = (await source!.query(
      "INSERT INTO `users` (`phone`, `phone_verified`) VALUES ('13900000078', 1)",
    )) as { insertId: string | number };
    const { insertId: purchaseId } = (await source!.query(
      `INSERT INTO \`membership_purchase_orders\`
        (\`purchase_no\`, \`user_id\`, \`membership_level_id\`, \`level_code\`,
         \`level_name\`, \`level_rank\`, \`price_cents\`, \`grant_credit_cents\`,
         \`discount_basis_points\`, \`valid_days\`, \`benefits\`, \`theme\`,
         \`badge_text\`, \`status\`, \`payment_status\`, \`idempotency_key\`,
         \`request_hash\`)
       SELECT 'MPDEFAULTLEVEL00000002', ?, \`id\`, \`code\`, \`name\`, \`rank\`,
              \`price_cents\`, \`grant_credit_cents\`, \`discount_basis_points\`,
              \`valid_days\`, \`benefits\`, \`theme\`, \`badge_text\`,
              'PENDING', 'PENDING', 'default-membership-down-guard', ?
       FROM \`membership_levels\`
       WHERE \`id\` = ?`,
      [String(userId), 'e'.repeat(64), String(customLevelId)],
    )) as { insertId: string | number };
    await source!.query(
      `INSERT INTO \`user_memberships\`
        (\`user_id\`, \`purchase_order_id\`, \`membership_level_id\`, \`level_code\`,
         \`level_name\`, \`level_rank\`, \`discount_basis_points\`, \`benefits\`,
         \`theme\`, \`badge_text\`, \`starts_at\`, \`ends_at\`, \`status\`)
       SELECT ?, ?, \`id\`, \`code\`, \`name\`, \`rank\`,
              \`discount_basis_points\`, \`benefits\`, \`theme\`, \`badge_text\`,
              '2026-01-01 00:00:00', '2027-01-01 00:00:00', 'ACTIVE'
       FROM \`membership_levels\`
       WHERE \`id\` = ?`,
      [String(userId), String(purchaseId), defaultLevelId],
    );

    await expect(
      source!.undoLastMigration({ transaction: 'each' }),
    ).rejects.toThrow(/user_memberships/);
    const levels = await readLevels(source!);
    expect(
      levels.filter(({ code }) =>
        ['SILVER', 'GOLD', 'DIAMOND', 'BLACK'].includes(code),
      ),
    ).toHaveLength(4);
  });
});
