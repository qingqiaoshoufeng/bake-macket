import 'reflect-metadata';

import {
  AdminRole,
  ApiErrorCode,
  SUPER_ADMIN_PERMISSIONS,
} from '@bake-mall/contracts';
import { randomUUID } from 'node:crypto';
import {
  DataSource,
  type EntityManager,
  type EntityTarget,
  type ObjectLiteral,
  type Repository,
} from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { type AuthenticatedAdmin } from '../src/auth/auth.types.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import * as entities from '../src/database/entities/index.js';
import { User } from '../src/database/entities/user.entity.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { AdminUsersService } from '../src/users/admin-users.service.js';
import { UserIdentityService } from '../src/users/user-identity.service.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_admin_users_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const RACE_PHONE = '13800000000';

const createBarrier = (parties: number): { wait: () => Promise<void> } => {
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
};

const decorateManager = (
  manager: EntityManager,
  userLookupBarrier: { wait: () => Promise<void> },
): EntityManager =>
  new Proxy(manager, {
    get(target, property) {
      if (property !== 'getRepository') {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return <Entity extends ObjectLiteral>(entity: EntityTarget<Entity>) => {
        const repository = target.getRepository(entity);
        if (entity !== User) return repository;
        return new Proxy(repository, {
          get(repositoryTarget, repositoryProperty) {
            if (repositoryProperty !== 'findOne') {
              const value = Reflect.get(
                repositoryTarget,
                repositoryProperty,
                repositoryTarget,
              ) as unknown;
              return typeof value === 'function'
                ? value.bind(repositoryTarget)
                : value;
            }
            return async (
              options: Parameters<Repository<Entity>['findOne']>[0],
            ) => {
              const result = await repositoryTarget.findOne(options);
              const phone = (options.where as { phone?: unknown }).phone;
              if (phone === RACE_PHONE && result === null) {
                await userLookupBarrier.wait();
              }
              return result;
            };
          },
        });
      };
    },
  });

const dataSourceWithUserLookupBarrier = (
  source: DataSource,
  transactionErrors: unknown[],
): DataSource => {
  const userLookupBarrier = createBarrier(2);
  return new Proxy(source, {
    get(target, property) {
      if (property !== 'transaction') {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async <T>(operation: (manager: EntityManager) => Promise<T>) => {
        try {
          return await target.transaction((manager) =>
            operation(decorateManager(manager, userLookupBarrier)),
          );
        } catch (error) {
          transactionErrors.push(error);
          throw error;
        }
      };
    },
  });
};

const exceptionCode = (error: unknown): unknown => {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  return typeof response === 'object' && response !== null && 'code' in response
    ? (response as { code?: unknown }).code
    : undefined;
};

const principal = (id: string): AuthenticatedAdmin => ({
  id,
  username: 'admin-users-race@example.com',
  role: AdminRole.SUPER_ADMIN,
  linkedUserId: null,
  mustChangePassword: false,
  permissions: SUPER_ADMIN_PERMISSIONS,
});

describe.sequential('AdminUsersService unique phone race (MySQL)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let database: DataSource | undefined;
  let admin: AdminUser;

  const requireDatabase = (): DataSource => {
    if (!database)
      throw new Error('Temporary MySQL data source is unavailable');
    return database;
  };

  beforeAll(async () => {
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      database = new DataSource({
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
      await database.initialize();
      await database.runMigrations();
      const admins = database.getRepository(AdminUser);
      admin = await admins.save(
        admins.create({
          username: 'admin-users-race@example.com',
          role: AdminRole.SUPER_ADMIN,
          linkedUserId: null,
          passwordHash: 'not-used-by-this-test',
          isActive: true,
          mustChangePassword: false,
          tokenVersion: 1,
          verifyFailedCount: 0,
          verifyWindowStartedAt: null,
          lastPasswordChangedAt: null,
        }),
      );
    } catch (error) {
      try {
        if (database?.isInitialized) await database.destroy();
      } finally {
        cleanupDatabase?.();
        cleanupDatabase = undefined;
      }
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    try {
      if (database?.isInitialized) await database.destroy();
    } finally {
      cleanupDatabase?.();
      cleanupDatabase = undefined;
    }
    expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
      schemaCount: 0,
      grantCount: 0,
    });
  });

  it('并发创建同一手机号时由 MySQL unique constraint 决出唯一成功事务', async () => {
    const source = requireDatabase();
    const transactionErrors: unknown[] = [];
    const racingSource = dataSourceWithUserLookupBarrier(
      source,
      transactionErrors,
    );
    const service = new AdminUsersService(
      racingSource,
      {} as never,
      new AuditService(source.getRepository(AuditLog)),
      new UserIdentityService(racingSource),
    );

    const outcomes = await Promise.allSettled([
      service.createPlaceholder(principal(admin.id), { phone: RACE_PHONE }),
      service.createPlaceholder(principal(admin.id), { phone: RACE_PHONE }),
    ]);

    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled',
    );
    const rejected = outcomes.filter(
      (outcome) => outcome.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(exceptionCode(rejected[0]?.reason)).toBe(
      ApiErrorCode.ADMIN_USER_CONFLICT,
    );
    expect(transactionErrors).toHaveLength(1);
    expect(transactionErrors[0]).toMatchObject({
      code: 'ER_DUP_ENTRY',
      errno: 1062,
    });
    expect(
      await source.getRepository(User).count({ where: { phone: RACE_PHONE } }),
    ).toBe(1);
    expect(
      await source.getRepository(AuditLog).count({
        where: { action: 'ADMIN_PLACEHOLDER_USER_CREATED' },
      }),
    ).toBe(1);
  }, 30_000);

  it('列表搜索不对非数字 ID 做 MySQL 强转，并按字面量匹配 LIKE 特殊字符', async () => {
    const source = requireDatabase();
    const users = source.getRepository(User);
    await users.save([
      users.create({ id: '7', nickname: 'ordinary', phone: null }),
      users.create({ id: '8', nickname: 'literal_value', phone: null }),
      users.create({ id: '9', nickname: 'literal%value', phone: null }),
      users.create({
        id: '10',
        nickname: String.raw`literal\value`,
        phone: null,
      }),
    ]);
    const service = new AdminUsersService(
      source,
      {} as never,
      {} as never,
      {} as never,
    );
    const searchIds = async (q: string): Promise<string[]> =>
      (
        await service.list({
          page: 1,
          pageSize: 20,
          q,
        })
      ).items.map((item) => item.id);

    await expect(searchIds('7foo')).resolves.toEqual([]);
    await expect(searchIds('_')).resolves.toEqual(['8']);
    await expect(searchIds('%')).resolves.toEqual(['9']);
    await expect(searchIds('\\')).resolves.toEqual(['10']);
  });
});
