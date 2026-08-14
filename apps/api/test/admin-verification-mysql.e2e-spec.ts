import 'reflect-metadata';

import { AdminRole, ApiErrorCode } from '@bake-mall/contracts';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import {
  ADMIN_LOGIN_BUCKET_COUNT,
  AdminVerificationService,
  calculateAdminLoginBucketId,
} from '../src/auth/admin-verification.service.js';
import { AdminLoginVerificationBucket } from '../src/database/entities/admin-login-verification-bucket.entity.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import * as entities from '../src/database/entities/index.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_admin_verify_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const PROCESS_SKEWED_NOW = new Date('2036-08-04T08:00:00.000Z');
const SECRET = 'mysql-admin-secret-at-least-32-characters';

const exceptionCode = (error: unknown): unknown => {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  return typeof response === 'object' && response !== null && 'code' in response
    ? (response as { code?: unknown }).code
    : undefined;
};

const codesOf = (outcomes: PromiseSettledResult<unknown>[]): unknown[] =>
  outcomes.map((outcome) =>
    outcome.status === 'rejected' ? exceptionCode(outcome.reason) : 'FULFILLED',
  );

const findIdentifier = (
  prefix: string,
  predicate: (bucketId: number) => boolean,
): { identifier: string; bucketId: number } => {
  for (let index = 0; index < 100_000; index += 1) {
    const identifier = `${prefix}-${index}@example.com`;
    const bucketId = calculateAdminLoginBucketId(
      SECRET,
      'SUPER_ADMIN',
      identifier,
    );
    if (predicate(bucketId)) return { identifier, bucketId };
  }
  throw new Error(`Unable to find bucket fixture for ${prefix}`);
};

describe.sequential('admin verification concurrency (MySQL)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let database: DataSource | undefined;
  let service: AdminVerificationService;

  const requireDatabase = (): DataSource => {
    if (!database)
      throw new Error('Temporary MySQL data source is unavailable');
    return database;
  };

  const databaseNow = async (): Promise<Date> => {
    const [row] = (await requireDatabase().query(
      'SELECT UTC_TIMESTAMP(6) AS `database_now`',
    )) as Array<{ database_now: Date | string }>;
    const value = row?.database_now;
    const parsed =
      value instanceof Date
        ? value
        : new Date(`${String(value).replace(' ', 'T')}Z`);
    if (!Number.isFinite(parsed.getTime())) {
      throw new Error('MySQL test database returned an invalid UTC time');
    }
    return parsed;
  };

  const expectDatabaseTimestampBetween = (
    value: Date | null,
    earliest: Date,
    latest: Date,
  ): void => {
    const earliestStoredSecond = Math.floor(earliest.getTime() / 1000) * 1000;
    const latestStoredSecond = Math.ceil(latest.getTime() / 1000) * 1000;
    expect(value).toBeInstanceOf(Date);
    expect(value?.getTime()).toBeGreaterThanOrEqual(earliestStoredSecond);
    expect(value?.getTime()).toBeLessThanOrEqual(latestStoredSecond);
  };

  const resetBucket = async (bucketId: number): Promise<void> => {
    await requireDatabase().getRepository(AdminLoginVerificationBucket).update(
      { bucketId },
      {
        failedCount: 0,
        windowStartedAt: null,
      },
    );
  };

  const createAdmin = async (
    username: string,
    overrides: Partial<AdminUser> = {},
  ): Promise<AdminUser> => {
    const admins = requireDatabase().getRepository(AdminUser);
    return admins.save(
      admins.create({
        username,
        role: AdminRole.SUPER_ADMIN,
        linkedUserId: null,
        passwordHash: await bcrypt.hash('correct-password', 10),
        isActive: true,
        mustChangePassword: false,
        tokenVersion: 1,
        verifyFailedCount: 0,
        verifyWindowStartedAt: null,
        lastPasswordChangedAt: null,
        ...overrides,
      }),
    );
  };

  const verifyPublic = (
    normalizedIdentifier: string,
    candidatePassword: string,
    adminId?: string,
  ) =>
    service.verifyPublicLogin({
      loginKind: 'SUPER_ADMIN',
      normalizedIdentifier,
      candidatePassword,
      now: PROCESS_SKEWED_NOW,
      resolveAdmin: (manager: EntityManager) =>
        adminId
          ? manager.getRepository(AdminUser).findOne({
              where: { id: adminId },
              lock: { mode: 'pessimistic_write' },
            })
          : Promise.resolve(null),
    });

  const verifyAuthenticated = (adminId: string, candidatePassword: string) =>
    service.verifyPassword({
      adminId,
      candidatePassword,
      now: PROCESS_SKEWED_NOW,
      context: { purpose: 'HIGH_RISK_ACTION' },
    });

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
      service = new AdminVerificationService(
        database,
        new AuditService(database.getRepository(AuditLog)),
        { get: () => ({ JWT_ADMIN_SECRET: SECRET }) } as never,
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

  it('known 与 unknown 十并发都恰好五次失败、五次限流，双层计数无丢失', async () => {
    const source = requireDatabase();
    const known = findIdentifier('known-concurrent', () => true);
    const unknown = findIdentifier(
      'unknown-concurrent',
      (bucketId) => bucketId !== known.bucketId,
    );
    await Promise.all([
      resetBucket(known.bucketId),
      resetBucket(unknown.bucketId),
    ]);
    const admin = await createAdmin(known.identifier);
    const earliestDatabaseTime = await databaseNow();

    const [knownOutcomes, unknownOutcomes] = await Promise.all([
      Promise.allSettled(
        Array.from({ length: 10 }, (_, index) =>
          verifyPublic(known.identifier, `known-wrong-${index}`, admin.id),
        ),
      ),
      Promise.allSettled(
        Array.from({ length: 10 }, (_, index) =>
          verifyPublic(unknown.identifier, `unknown-wrong-${index}`),
        ),
      ),
    ]);
    const latestDatabaseTime = await databaseNow();
    const knownCodes = codesOf(knownOutcomes);
    const unknownCodes = codesOf(unknownOutcomes);
    const [savedAdmin, knownBucket, unknownBucket] = await Promise.all([
      source.getRepository(AdminUser).findOneByOrFail({ id: admin.id }),
      source
        .getRepository(AdminLoginVerificationBucket)
        .findOneByOrFail({ bucketId: known.bucketId }),
      source
        .getRepository(AdminLoginVerificationBucket)
        .findOneByOrFail({ bucketId: unknown.bucketId }),
    ]);

    for (const codes of [knownCodes, unknownCodes]) {
      expect(
        codes.filter((code) => code === ApiErrorCode.ADMIN_VERIFICATION_FAILED),
      ).toHaveLength(5);
      expect(
        codes.filter(
          (code) => code === ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
        ),
      ).toHaveLength(5);
      expect(codes).not.toContain('FULFILLED');
    }
    expect(savedAdmin).toMatchObject({ verifyFailedCount: 5 });
    expectDatabaseTimestampBetween(
      savedAdmin.verifyWindowStartedAt,
      earliestDatabaseTime,
      latestDatabaseTime,
    );
    for (const bucket of [knownBucket, unknownBucket]) {
      expect(bucket).toMatchObject({ failedCount: 5 });
      expectDatabaseTimestampBetween(
        bucket.windowStartedAt,
        earliestDatabaseTime,
        latestDatabaseTime,
      );
    }
    expect(
      await source.getRepository(AdminLoginVerificationBucket).count(),
    ).toBe(ADMIN_LOGIN_BUCKET_COUNT);
    expect(
      await source.getRepository(AuditLog).count({
        where: { action: 'ADMIN_PASSWORD_VERIFICATION' },
      }),
    ).toBe(0);
  }, 30_000);

  it('已认证精确窗口六并发恰好前五次失败、第六次限流且计数无丢失', async () => {
    const source = requireDatabase();
    const fixture = findIdentifier('authenticated-exact-boundary', () => true);
    const admin = await createAdmin(fixture.identifier);
    const earliestDatabaseTime = await databaseNow();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        verifyAuthenticated(admin.id, `authenticated-wrong-${index}`),
      ),
    );
    const latestDatabaseTime = await databaseNow();
    const codes = codesOf(outcomes);

    expect(
      codes.filter((code) => code === ApiErrorCode.ADMIN_VERIFICATION_FAILED),
    ).toHaveLength(5);
    expect(
      codes.filter(
        (code) => code === ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
      ),
    ).toHaveLength(1);
    expect(codes).not.toContain('FULFILLED');
    const savedAdmin = await source
      .getRepository(AdminUser)
      .findOneByOrFail({ id: admin.id });
    expect(savedAdmin).toMatchObject({ verifyFailedCount: 5 });
    expectDatabaseTimestampBetween(
      savedAdmin.verifyWindowStartedAt,
      earliestDatabaseTime,
      latestDatabaseTime,
    );

    const audits = await source.getRepository(AuditLog).find({
      where: { action: 'ADMIN_PASSWORD_VERIFICATION' },
      order: { id: 'ASC' },
    });
    expect(audits).toHaveLength(6);
    expect(
      audits.map(({ changeSummary }) => ({
        count: changeSummary?.count,
        result: changeSummary?.result,
      })),
    ).toEqual([
      { count: 1, result: 'FAILED' },
      { count: 2, result: 'FAILED' },
      { count: 3, result: 'FAILED' },
      { count: 4, result: 'FAILED' },
      { count: 5, result: 'FAILED' },
      { count: 5, result: 'RATE_LIMITED' },
    ]);
  }, 30_000);

  it('admin 精确窗口已满而 bucket 新鲜时，known 与 unknown 都先 401 且 admin 不变', async () => {
    const source = requireDatabase();
    const known = findIdentifier('known-exact-limited', () => true);
    const unknown = findIdentifier(
      'unknown-exact-limited',
      (bucketId) => bucketId !== known.bucketId,
    );
    await Promise.all([
      resetBucket(known.bucketId),
      resetBucket(unknown.bucketId),
    ]);
    const databaseTime = await databaseNow();
    const activeWindowStartedAt = new Date(
      Math.floor((databaseTime.getTime() - 60_000) / 1000) * 1000,
    );
    const admin = await createAdmin(known.identifier, {
      verifyFailedCount: 5,
      verifyWindowStartedAt: activeWindowStartedAt,
    });
    const earliestDatabaseTime = await databaseNow();

    const outcomes = await Promise.allSettled([
      verifyPublic(known.identifier, 'correct-password', admin.id),
      verifyPublic(unknown.identifier, 'correct-password'),
    ]);
    const latestDatabaseTime = await databaseNow();
    expect(codesOf(outcomes)).toEqual([
      ApiErrorCode.ADMIN_VERIFICATION_FAILED,
      ApiErrorCode.ADMIN_VERIFICATION_FAILED,
    ]);

    const [savedAdmin, knownBucket, unknownBucket] = await Promise.all([
      source.getRepository(AdminUser).findOneByOrFail({ id: admin.id }),
      source
        .getRepository(AdminLoginVerificationBucket)
        .findOneByOrFail({ bucketId: known.bucketId }),
      source
        .getRepository(AdminLoginVerificationBucket)
        .findOneByOrFail({ bucketId: unknown.bucketId }),
    ]);
    expect(savedAdmin).toMatchObject({
      verifyFailedCount: 5,
      verifyWindowStartedAt: activeWindowStartedAt,
    });
    for (const bucket of [knownBucket, unknownBucket]) {
      expect(bucket).toMatchObject({ failedCount: 1 });
      expectDatabaseTimestampBetween(
        bucket.windowStartedAt,
        earliestDatabaseTime,
        latestDatabaseTime,
      );
    }
  }, 30_000);

  it('碰撞的 known 与 unknown 共享 bucket 限流，不泄露账户存在性', async () => {
    const source = requireDatabase();
    const known = findIdentifier('collision-known', () => true);
    const unknown = findIdentifier(
      'collision-unknown',
      (bucketId) => bucketId === known.bucketId,
    );
    await resetBucket(known.bucketId);
    const admin = await createAdmin(known.identifier);
    const earliestDatabaseTime = await databaseNow();

    const knownOutcomes = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        verifyPublic(known.identifier, `collision-wrong-${index}`, admin.id),
      ),
    );
    const unknownOutcome = await Promise.allSettled([
      verifyPublic(unknown.identifier, 'collision-sixth'),
    ]);
    const latestDatabaseTime = await databaseNow();

    expect(codesOf(knownOutcomes)).toEqual(
      Array.from({ length: 5 }, () => ApiErrorCode.ADMIN_VERIFICATION_FAILED),
    );
    expect(codesOf(unknownOutcome)).toEqual([
      ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
    ]);
    expect(
      await source.getRepository(AdminUser).findOneByOrFail({ id: admin.id }),
    ).toMatchObject({ verifyFailedCount: 5 });
    const bucket = await source
      .getRepository(AdminLoginVerificationBucket)
      .findOneByOrFail({ bucketId: known.bucketId });
    expect(bucket).toMatchObject({ failedCount: 5 });
    expectDatabaseTimestampBetween(
      bucket.windowStartedAt,
      earliestDatabaseTime,
      latestDatabaseTime,
    );
  }, 30_000);

  it('一百个不同 bucket 的公开失败不会扩表或写逐次 AuditLog', async () => {
    const source = requireDatabase();
    const auditCountBefore = await source.getRepository(AuditLog).count({
      where: { action: 'ADMIN_PASSWORD_VERIFICATION' },
    });
    const fixtures: Array<{ identifier: string; bucketId: number }> = [];
    const used = new Set<number>();
    for (let index = 0; fixtures.length < 100; index += 1) {
      const fixture = findIdentifier(`capacity-${index}`, (bucketId) => {
        if (used.has(bucketId)) return false;
        used.add(bucketId);
        return true;
      });
      fixtures.push(fixture);
    }
    await Promise.all(fixtures.map(({ bucketId }) => resetBucket(bucketId)));

    const outcomes = await Promise.allSettled(
      fixtures.map(({ identifier }, index) =>
        verifyPublic(identifier, `capacity-password-${index}`),
      ),
    );
    expect(codesOf(outcomes)).toEqual(
      Array.from(
        { length: fixtures.length },
        () => ApiErrorCode.ADMIN_VERIFICATION_FAILED,
      ),
    );
    expect(
      await source.getRepository(AdminLoginVerificationBucket).count(),
    ).toBe(ADMIN_LOGIN_BUCKET_COUNT);
    expect(
      await source.getRepository(AuditLog).count({
        where: { action: 'ADMIN_PASSWORD_VERIFICATION' },
      }),
    ).toBe(auditCountBefore);

    const rows = await source
      .getRepository(AdminLoginVerificationBucket)
      .findBy(fixtures.map(({ bucketId }) => ({ bucketId })));
    expect(rows).toHaveLength(100);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('capacity-');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('identifier');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('phone');
  }, 30_000);
});
