import 'reflect-metadata';

import {
  ApiErrorCode,
  MembershipLevelStatus,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipTheme,
  type SaveMembershipLevelRequest,
} from '@bake-mall/contracts';
import { randomUUID } from 'node:crypto';
import {
  DataSource,
  EntityManager,
  type EntityTarget,
  type ObjectLiteral,
  type Repository,
} from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import * as entities from '../src/database/entities/index.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import { MembershipLevel } from '../src/database/entities/membership-level.entity.js';
import {
  MembershipPaymentChannel,
  MembershipPurchaseOrder,
} from '../src/database/entities/membership-purchase-order.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { MembershipService } from '../src/membership/membership.service.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_membership_levels_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };

function levelRequest(
  overrides: Partial<SaveMembershipLevelRequest> = {},
): SaveMembershipLevelRequest {
  return {
    code: 'LEVELS_BASE',
    name: '鎏金会员',
    rank: 110,
    priceCents: 50_000,
    grantCreditCents: 60_000,
    discountBasisPoints: 9_500,
    validDays: 365,
    benefits: [{ title: '全场九五折', sortOrder: 10 }],
    cardTheme: { theme: MembershipTheme.CHAMPAGNE, badgeText: 'GOLD' },
    sortOrder: 20,
    status: MembershipLevelStatus.ACTIVE,
    ...overrides,
  };
}

function createBarrier(parties: number): { wait: () => Promise<void> } {
  let arrived = 0;
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    wait: async () => {
      arrived += 1;
      if (arrived >= parties) release();
      await released;
    },
  };
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function decorateManager(
  manager: EntityManager,
  decorateRepository: <Entity extends ObjectLiteral>(
    entity: EntityTarget<Entity>,
    repository: Repository<Entity>,
  ) => Repository<Entity>,
): EntityManager {
  return new Proxy(manager, {
    get(target, property, receiver) {
      if (property !== 'getRepository') {
        return Reflect.get(target, property, receiver);
      }
      return <Entity extends ObjectLiteral>(entity: EntityTarget<Entity>) => {
        const repository = target.getRepository(entity);
        return decorateRepository(entity, repository);
      };
    },
  });
}

function dataSourceWithTransactionBarrier(
  source: DataSource,
  decorate: (manager: EntityManager) => EntityManager,
): DataSource {
  return {
    transaction: async <T>(
      operation: (manager: EntityManager) => Promise<T>,
    ) => {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        const result = await operation(decorate(runner.manager));
        await runner.commitTransaction();
        return result;
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
    },
  } as DataSource;
}

function purchaseFor(
  level: Awaited<ReturnType<MembershipService['createLevel']>>,
  userId: string,
): MembershipPurchaseOrder {
  return {
    purchaseNo: `MP${randomUUID().replaceAll('-', '').slice(0, 20)}`,
    userId,
    membershipLevelId: level.id,
    levelCode: level.code,
    levelName: level.name,
    levelRank: level.rank,
    priceCents: level.priceCents,
    grantCreditCents: level.grantCreditCents,
    discountBasisPoints: level.discountBasisPoints,
    validDays: level.validDays,
    benefits: level.benefits,
    theme: level.cardTheme.theme,
    badgeText: level.cardTheme.badgeText,
    status: MembershipPurchaseStatus.PENDING,
    paymentStatus: MembershipPaymentStatus.PENDING,
    paymentChannel: MembershipPaymentChannel.SIMULATED,
    idempotencyKey: randomUUID(),
    requestHash: 'a'.repeat(64),
    paidAt: null,
    voidedAt: null,
  } as MembershipPurchaseOrder;
}

describe.sequential('MembershipService real MySQL level management', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let dataSource: DataSource | undefined;
  let service: MembershipService;
  let admin: AdminUser;
  let user: User;

  beforeAll(async () => {
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      dataSource = new DataSource({
        type: 'mysql',
        host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
        port: Number(process.env.TEST_MYSQL_PORT ?? 44306),
        database: DATABASE_NAME,
        username: APP_USER,
        password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
        charset: 'utf8mb4',
        timezone: 'Z',
        synchronize: false,
        entities: Object.values(entities),
        migrations: [...DATABASE_MIGRATIONS],
        migrationsTableName: 'migrations',
        migrationsTransactionMode: 'each',
      });
      await dataSource.initialize();
      await dataSource.runMigrations();
      admin = await dataSource.getRepository(AdminUser).save(
        dataSource.getRepository(AdminUser).create({
          username: 'membership-task-3-admin',
          passwordHash: 'not-used-by-this-test',
          isActive: true,
        }),
      );
      user = await dataSource.getRepository(User).save(
        dataSource.getRepository(User).create({
          phone: '13900000003',
          phoneVerified: true,
        }),
      );
      service = new MembershipService(
        dataSource.getRepository(MembershipLevel),
        dataSource.getRepository(MembershipPurchaseOrder),
        new AuditService(dataSource.getRepository(AuditLog)),
        dataSource,
      );
    } catch (error) {
      if (dataSource?.isInitialized) await dataSource.destroy();
      cleanupDatabase?.();
      cleanupDatabase = undefined;
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) await dataSource.destroy();
    } finally {
      cleanupDatabase?.();
      cleanupDatabase = undefined;
    }
    expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
      schemaCount: 0,
      grantCount: 0,
    });
  });

  it('persists the created level and audit row in one successful transaction', async () => {
    const created = await service.createLevel(levelRequest(), admin.id);
    const level = await dataSource
      ?.getRepository(MembershipLevel)
      .findOneBy({ id: created.id });
    const audit = await dataSource?.getRepository(AuditLog).findOneBy({
      targetEntity: 'membership_levels',
      targetId: created.id,
      action: 'MEMBERSHIP_LEVEL_CREATED',
    });
    expect(level).toMatchObject({ code: 'LEVELS_BASE', version: 1 });
    expect(audit).toMatchObject({ adminUserId: admin.id });
  });

  it('rolls back level creation when the real audit insert violates its FK', async () => {
    await expect(
      service.createLevel(
        levelRequest({ code: 'CREATE_ROLLBACK', rank: 120 }),
        '999999999999',
      ),
    ).rejects.toBeDefined();
    await expect(
      dataSource
        ?.getRepository(MembershipLevel)
        .findOneBy({ code: 'CREATE_ROLLBACK' }),
    ).resolves.toBeNull();
  });

  it('rolls back fields and version when a real update audit insert fails', async () => {
    const before = await dataSource
      ?.getRepository(MembershipLevel)
      .findOneByOrFail({ code: 'LEVELS_BASE' });
    if (!before) throw new Error('LEVELS_BASE fixture is missing');
    await expect(
      service.updateLevel(
        before.id,
        levelRequest({ name: '不应提交的名称', version: before.version }),
        '999999999999',
      ),
    ).rejects.toBeDefined();
    const after = await dataSource
      ?.getRepository(MembershipLevel)
      .findOneByOrFail({ id: before.id });
    expect(after).toMatchObject({ name: before.name, version: before.version });
  });

  it('rolls back deletion when a real delete audit insert fails', async () => {
    const created = await service.createLevel(
      levelRequest({
        code: 'DELETE_ROLLBACK',
        rank: 130,
        status: MembershipLevelStatus.INACTIVE,
      }),
      admin.id,
    );
    await expect(
      service.deleteLevel(created.id, '999999999999'),
    ).rejects.toBeDefined();
    await expect(
      dataSource?.getRepository(MembershipLevel).findOneBy({ id: created.id }),
    ).resolves.toMatchObject({ code: 'DELETE_ROLLBACK' });
  });

  it('allows exactly one update after both real transactions read the same version', async () => {
    if (!dataSource) throw new Error('Temporary data source is unavailable');
    const existing = await dataSource
      .getRepository(MembershipLevel)
      .findOneByOrFail({ code: 'LEVELS_BASE' });
    const bothReadInitialVersion = createBarrier(2);
    const barrierDataSource = dataSourceWithTransactionBarrier(
      dataSource,
      (manager) =>
        decorateManager(manager, (entity, repository) => {
          if (entity !== MembershipLevel) return repository;
          return new Proxy(repository, {
            get(target, property, receiver) {
              if (property !== 'findOneBy') {
                return Reflect.get(target, property, receiver);
              }
              return async (where: { id?: string }) => {
                const level = await (
                  target as unknown as Repository<MembershipLevel>
                ).findOneBy(where);
                if (
                  where.id === existing.id &&
                  level?.version === existing.version
                ) {
                  await bothReadInitialVersion.wait();
                }
                return level;
              };
            },
          });
        }),
    );
    const concurrentService = new MembershipService(
      dataSource.getRepository(MembershipLevel),
      dataSource.getRepository(MembershipPurchaseOrder),
      new AuditService(dataSource.getRepository(AuditLog)),
      barrierDataSource,
    );
    const updates = await Promise.allSettled([
      concurrentService.updateLevel(
        existing.id,
        levelRequest({ name: '并发更新 A', version: existing.version }),
        admin.id,
      ),
      concurrentService.updateLevel(
        existing.id,
        levelRequest({ name: '并发更新 B', version: existing.version }),
        admin.id,
      ),
    ]);
    const fulfilled = updates.filter(({ status }) => status === 'fulfilled');
    const rejected = updates.filter(({ status }) => status === 'rejected');
    const saved = await dataSource
      .getRepository(MembershipLevel)
      .findOneByOrFail({ id: existing.id });
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({
        response: expect.objectContaining({
          code: ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT,
        }),
      }),
    });
    expect(saved.version).toBe(existing.version + 1);
  });

  it.each([
    ['code', levelRequest({ rank: 140 })],
    ['rank', levelRequest({ code: 'LEVELS_DUPLICATE_RANK' })],
  ] as const)(
    'translates a real duplicate %s constraint into a business conflict',
    async (field, duplicate) => {
      await expect(
        service.createLevel(duplicate, admin.id),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: ApiErrorCode.MEMBERSHIP_LEVEL_CONFLICT,
          details: expect.objectContaining({ [field]: duplicate[field] }),
        }),
      });
    },
  );

  it('protects a level with a real purchase row from deletion', async () => {
    if (!dataSource) throw new Error('Temporary data source is unavailable');
    const soldLevel = await service.createLevel(
      levelRequest({
        code: 'SOLD',
        rank: 150,
        status: MembershipLevelStatus.INACTIVE,
      }),
      admin.id,
    );
    await dataSource
      .getRepository(MembershipPurchaseOrder)
      .save(
        dataSource
          .getRepository(MembershipPurchaseOrder)
          .create(purchaseFor(soldLevel, user.id)),
      );
    await expect(
      service.deleteLevel(soldLevel.id, admin.id),
    ).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({
        message: '已售会员等级不可删除，请改为下架',
      }),
    });
  });

  it('serializes a purchase insert behind the locked inactive-level deletion', async () => {
    if (!dataSource) throw new Error('Temporary data source is unavailable');
    const racedLevel = await service.createLevel(
      levelRequest({
        code: 'FK_RACE',
        rank: 160,
        status: MembershipLevelStatus.INACTIVE,
      }),
      admin.id,
    );
    const countCompleted = createDeferred();
    const resumeDeletion = createDeferred();
    const raceDataSource = dataSourceWithTransactionBarrier(
      dataSource,
      (manager) =>
        decorateManager(manager, (entity, repository) => {
          if (entity !== MembershipPurchaseOrder) return repository;
          return new Proxy(repository, {
            get(target, property, receiver) {
              if (property !== 'count') {
                return Reflect.get(target, property, receiver);
              }
              return async (options: Parameters<typeof target.count>[0]) => {
                const count = await target.count(options);
                countCompleted.resolve();
                await resumeDeletion.promise;
                return count;
              };
            },
          });
        }),
    );
    const raceService = new MembershipService(
      dataSource.getRepository(MembershipLevel),
      dataSource.getRepository(MembershipPurchaseOrder),
      new AuditService(dataSource.getRepository(AuditLog)),
      raceDataSource,
    );
    const deletion = raceService.deleteLevel(racedLevel.id, admin.id);
    await countCompleted.promise;
    const purchaseInsert = dataSource
      .getRepository(MembershipPurchaseOrder)
      .save(
        dataSource
          .getRepository(MembershipPurchaseOrder)
          .create(purchaseFor(racedLevel, user.id)),
      );
    const rejectedInsert = expect(purchaseInsert).rejects.toMatchObject({
      driverError: expect.objectContaining({ errno: 1452 }),
    });
    resumeDeletion.resolve();

    await expect(deletion).resolves.toBeUndefined();
    await rejectedInsert;
    await expect(
      dataSource
        .getRepository(MembershipLevel)
        .findOneBy({ id: racedLevel.id }),
    ).resolves.toBeNull();
  });
});
