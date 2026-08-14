import 'reflect-metadata';

import {
  AdminPermission,
  AdminRole,
  ApiErrorCode,
  OPERATOR_PERMISSIONS,
} from '@bake-mall/contracts';
import {
  Controller,
  Get,
  type INestApplication,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { RequireAdminPermissions } from '../src/auth/admin-permission.decorator.js';
import { AdminPermissionGuard } from '../src/auth/admin-permission.guard.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { JwtAdminGuard } from '../src/auth/admin-jwt.guard.js';
import { calculateAdminLoginBucketId } from '../src/auth/admin-verification.service.js';
import { UserAuthService } from '../src/auth/user-auth.service.js';
import { validateEnvironment } from '../src/config/env.schema.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AdminLoginVerificationBucket } from '../src/database/entities/admin-login-verification-bucket.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import * as entities from '../src/database/entities/index.js';
import { User } from '../src/database/entities/user.entity.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { UserIdentityService } from '../src/users/user-identity.service.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_operator_auth_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const SUPER_EMAIL = 'operator-e2e-admin@example.com';
const SUPER_PASSWORD = 'legacy-super-password';
const ADMIN_SECRET = 'operator-e2e-admin-secret-at-least-32';

const findDistinctIdentifier = (
  loginKind: 'SUPER_ADMIN' | 'OPERATOR',
  prefix: string,
  excludedBucketIds: ReadonlySet<number>,
): string => {
  for (let index = 0; index < 100_000; index += 1) {
    const identifier =
      loginKind === 'SUPER_ADMIN'
        ? `${prefix}-${index}@example.com`
        : `137${String(index).padStart(8, '0')}`;
    const bucketId = calculateAdminLoginBucketId(
      ADMIN_SECRET,
      loginKind,
      identifier,
    );
    if (!excludedBucketIds.has(bucketId)) return identifier;
  }
  throw new Error(`Unable to find distinct ${loginKind} bucket fixture`);
};

@Controller('admin/operator-probe')
@UseGuards(JwtAdminGuard, AdminPermissionGuard)
class OperatorPermissionProbeController {
  @Get()
  defaultDeny() {
    return { ok: true };
  }

  @Get('order-read')
  @RequireAdminPermissions(AdminPermission.ORDER_READ)
  orderRead() {
    return { ok: true };
  }
}

describe('OPERATOR auth (real MySQL e2e)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let database: DataSource;
  let app: INestApplication;
  let user: User;
  let superToken: string;
  let superVersionToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'development';
    process.env.MYSQL_HOST = process.env.TEST_MYSQL_HOST ?? '127.0.0.1';
    process.env.MYSQL_PORT = process.env.TEST_MYSQL_PORT ?? '44306';
    process.env.MYSQL_DATABASE = DATABASE_NAME;
    process.env.MYSQL_USER = APP_USER;
    process.env.MYSQL_PASSWORD =
      process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password';
    process.env.JWT_USER_SECRET = 'operator-e2e-user-secret-at-least-32';
    process.env.JWT_ADMIN_SECRET = ADMIN_SECRET;
    process.env.ADMIN_EMAIL = SUPER_EMAIL;
    process.env.ADMIN_PASSWORD = SUPER_PASSWORD;

    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      database = new DataSource({
        type: 'mysql',
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT),
        database: DATABASE_NAME,
        username: APP_USER,
        password: process.env.MYSQL_PASSWORD,
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

      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            validate: (raw) => ({
              appEnv: validateEnvironment(raw ?? process.env),
            }),
          }),
          TypeOrmModule.forRoot({
            ...database.options,
            migrations: [],
          }),
          AuthModule,
        ],
        controllers: [OperatorPermissionProbeController],
        providers: [
          JwtAdminGuard,
          AdminPermissionGuard,
          {
            provide: AuditService,
            useValue: { record: vi.fn().mockResolvedValue(undefined) },
          },
          {
            provide: getRepositoryToken(AdminUser),
            useFactory: () => database.getRepository(AdminUser),
          },
          {
            provide: getRepositoryToken(User),
            useFactory: () => database.getRepository(User),
          },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.init();

      user = await database.getRepository(User).save(
        database.getRepository(User).create({
          nickname: 'operator-e2e',
          avatarUrl: null,
          wechatOpenid: null,
          wechatUnionid: null,
          phone: '13800000000',
          phoneVerified: true,
          isActive: true,
          mergedIntoUserId: null,
          tokenVersion: 1,
        }),
      );
      superToken = (
        await request(app.getHttpServer())
          .post('/api/v1/admin/auth/login')
          .send({
            kind: 'SUPER_ADMIN',
            email: SUPER_EMAIL,
            password: SUPER_PASSWORD,
          })
          .expect(200)
      ).body.accessToken as string;
      superVersionToken = superToken;
    } catch (error) {
      try {
        await app?.close();
        if (database?.isInitialized) await database.destroy();
      } finally {
        cleanupDatabase?.();
      }
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    try {
      await app?.close();
      if (database?.isInitialized) await database.destroy();
    } finally {
      cleanupDatabase?.();
    }
    expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
      schemaCount: 0,
      grantCount: 0,
    });
  });

  it('统一 login 严格拒绝混合字段', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({
        kind: 'SUPER_ADMIN',
        email: SUPER_EMAIL,
        phone: user.phone,
        password: SUPER_PASSWORD,
      })
      .expect(400);
  });

  it('SUPER_ADMIN 公开登录只写固定 bucket 聚合，成功不清失败窗口且 known/unknown 不可枚举', async () => {
    const admins = database.getRepository(AdminUser);
    const audits = database.getRepository(AuditLog);
    const buckets = database.getRepository(AdminLoginVerificationBucket);
    const superAdmin = await admins.findOneByOrFail({ username: SUPER_EMAIL });
    const knownBucketId = calculateAdminLoginBucketId(
      ADMIN_SECRET,
      'SUPER_ADMIN',
      SUPER_EMAIL,
    );
    const unknownEmail = findDistinctIdentifier(
      'SUPER_ADMIN',
      'unknown-super',
      new Set([knownBucketId]),
    );
    const unknownBucketId = calculateAdminLoginBucketId(
      ADMIN_SECRET,
      'SUPER_ADMIN',
      unknownEmail,
    );

    expect(await buckets.count()).toBe(1024);
    expect(
      await audits.count({
        where: { action: 'ADMIN_PASSWORD_VERIFICATION' },
      }),
    ).toBe(0);

    const failures: Array<Response> = [];
    for (let count = 0; count < 5; count += 1) {
      failures.push(
        await request(app.getHttpServer())
          .post('/api/v1/admin/auth/login')
          .send({
            kind: 'SUPER_ADMIN',
            email: SUPER_EMAIL,
            password: `wrong-legacy-${count}`,
          }),
      );
    }
    expect(failures.map(({ status }) => status)).toEqual([
      401, 401, 401, 401, 401,
    ]);
    expect(failures.map(({ body }) => body)).toEqual(
      Array.from({ length: 5 }, () => ({
        code: ApiErrorCode.ADMIN_VERIFICATION_FAILED,
        message: 'Admin verification failed',
      })),
    );
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({
        kind: 'SUPER_ADMIN',
        email: SUPER_EMAIL,
        password: SUPER_PASSWORD,
      })
      .expect(429)
      .expect({
        code: ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
        message: 'Admin verification rate limited',
      });

    const expiredWindow = new Date(Date.now() - 6 * 60 * 1000);
    await Promise.all([
      admins.update(superAdmin.id, {
        verifyFailedCount: 0,
        verifyWindowStartedAt: null,
      }),
      buckets.update(knownBucketId, { windowStartedAt: expiredWindow }),
    ]);
    const persistedExpiredWindow = (
      await buckets.findOneByOrFail({ bucketId: knownBucketId })
    ).windowStartedAt;
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({
        kind: 'SUPER_ADMIN',
        email: SUPER_EMAIL,
        password: SUPER_PASSWORD,
      })
      .expect(200);

    const unknownFailures = [];
    for (let count = 0; count < 5; count += 1) {
      unknownFailures.push(
        await request(app.getHttpServer())
          .post('/api/v1/admin/auth/login')
          .send({
            kind: 'SUPER_ADMIN',
            email: `  ${unknownEmail.toUpperCase()}  `,
            password: `legacy-candidate-${count}`,
          }),
      );
    }
    expect(unknownFailures.map(({ status }) => status)).toEqual([
      401, 401, 401, 401, 401,
    ]);
    expect(unknownFailures.map(({ body }) => body)).toEqual(
      Array.from({ length: 5 }, () => failures[0]?.body),
    );
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({
        kind: 'SUPER_ADMIN',
        email: unknownEmail,
        password: 'legacy-candidate-5',
      })
      .expect(429)
      .expect({
        code: ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
        message: 'Admin verification rate limited',
      });

    const [knownBucket, unknownBucket, publicAuditCount] = await Promise.all([
      buckets.findOneByOrFail({ bucketId: knownBucketId }),
      buckets.findOneByOrFail({ bucketId: unknownBucketId }),
      audits.count({ where: { action: 'ADMIN_PASSWORD_VERIFICATION' } }),
    ]);
    expect(knownBucket.failedCount).toBe(5);
    expect(knownBucket.windowStartedAt).toEqual(persistedExpiredWindow);
    expect(unknownBucket.failedCount).toBe(5);
    expect(publicAuditCount).toBe(0);
    expect(await buckets.count()).toBe(1024);

    const serializedPublicData = JSON.stringify({ knownBucket, unknownBucket });
    expect(serializedPublicData).not.toContain(unknownEmail);
    expect(serializedPublicData).not.toContain('legacy-candidate');
    expect(serializedPublicData).not.toContain('identifier');
    expect(serializedPublicData).not.toContain('phone');
    expect(serializedPublicData).not.toContain('email');
  });

  it('拒绝 verified=true/phone=null 的历史脏 User，且不新增 admin', async () => {
    const users = database.getRepository(User);
    const admins = database.getRepository(AdminUser);
    const dirtyUser = await users.save(
      users.create({
        nickname: 'dirty-verified-phone',
        avatarUrl: null,
        wechatOpenid: null,
        wechatUnionid: null,
        phone: '13600000000',
        phoneVerified: true,
        isActive: true,
        mergedIntoUserId: null,
        tokenVersion: 1,
      }),
    );
    await database.query(
      'UPDATE users SET phone = NULL, phone_verified = TRUE WHERE id = ?',
      [dirtyUser.id],
    );
    const adminCountBefore = await admins.count();

    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${dirtyUser.id}/operator/grant`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        currentPassword: SUPER_PASSWORD,
        temporaryPassword: '123456',
        confirmTemporaryPassword: '123456',
      })
      .expect(409);

    expect(await admins.count()).toBe(adminCountBefore);
    expect(await admins.findOneBy({ linkedUserId: dirtyUser.id })).toBeNull();
  });

  it('完成授权、手机号登录、受限 gate、首次/普通改密和撤权即时失效', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${user.id}/operator/grant`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        currentPassword: SUPER_PASSWORD,
        temporaryPassword: '123456',
        confirmTemporaryPassword: '123456',
      })
      .expect(201);

    const stored = await database.getRepository(AdminUser).findOneByOrFail({
      linkedUserId: user.id,
    });
    expect(stored).toMatchObject({
      username: null,
      role: AdminRole.OPERATOR,
      linkedUserId: user.id,
      isActive: true,
      mustChangePassword: true,
    });
    await expect(
      database.getRepository(AdminUser).save(
        database.getRepository(AdminUser).create({
          username: null,
          role: AdminRole.OPERATOR,
          linkedUserId: user.id,
          passwordHash: stored.passwordHash,
          isActive: true,
          mustChangePassword: true,
          tokenVersion: 1,
          verifyFailedCount: 0,
          verifyWindowStartedAt: null,
          lastPasswordChangedAt: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });

    const restricted = (
      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/login')
        .send({ kind: 'OPERATOR', phone: ' 13800000000 ', password: '123456' })
        .expect(200)
    ).body as {
      accessToken: string;
      permissions: unknown[];
      mustChangePassword: boolean;
    };
    expect(restricted).toMatchObject({
      permissions: [],
      mustChangePassword: true,
    });
    await request(app.getHttpServer())
      .get('/api/v1/admin/operator-probe')
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/operator-probe/order-read')
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/password')
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({
        currentPassword: '123456',
        newPassword: '654321',
        confirmPassword: '654321',
      })
      .expect(403);

    const full = (
      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/password/initial')
        .set('Authorization', `Bearer ${restricted.accessToken}`)
        .send({
          temporaryPassword: '123456',
          newPassword: '654321',
          confirmPassword: '654321',
        })
        .expect(200)
    ).body as { accessToken: string; permissions: unknown[] };
    expect(full.permissions).toEqual(OPERATOR_PERMISSIONS);
    await request(app.getHttpServer())
      .get('/api/v1/admin/operator-probe/order-read')
      .set('Authorization', `Bearer ${full.accessToken}`)
      .expect(200)
      .expect({ ok: true });
    await request(app.getHttpServer())
      .get('/api/v1/admin/operator-probe')
      .set('Authorization', `Bearer ${full.accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/operator-probe/order-read')
      .set('Authorization', `Bearer ${superToken}`)
      .expect(200)
      .expect({ ok: true });
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/password/initial')
      .set('Authorization', `Bearer ${restricted.accessToken}`)
      .send({
        temporaryPassword: '123456',
        newPassword: '654321',
        confirmPassword: '654321',
      })
      .expect(401);

    const changed = (
      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/password')
        .set('Authorization', `Bearer ${full.accessToken}`)
        .send({
          currentPassword: '654321',
          newPassword: '777777',
          confirmPassword: '777777',
        })
        .expect(200)
    ).body as { accessToken: string; mustChangePassword: boolean };
    expect(changed.mustChangePassword).toBe(false);
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/password')
      .set('Authorization', `Bearer ${full.accessToken}`)
      .send({
        currentPassword: '654321',
        newPassword: '888888',
        confirmPassword: '888888',
      })
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${user.id}/operator/revoke`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({ currentPassword: SUPER_PASSWORD })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/password')
      .set('Authorization', `Bearer ${changed.accessToken}`)
      .send({
        currentPassword: '777777',
        newPassword: '888888',
        confirmPassword: '888888',
      })
      .expect(401);
  });

  it('mall-user 换管理会话并在 linked phone/verified 变化后拒绝', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${user.id}/operator/grant`)
      .set('Authorization', `Bearer ${superToken}`)
      .send({
        currentPassword: SUPER_PASSWORD,
        temporaryPassword: '222222',
        confirmTemporaryPassword: '222222',
      })
      .expect(201);

    const userAuth = app.get(UserAuthService);
    const mallUserToken = (
      await userAuth.loginWithDevelopmentCode('13800000000', '123456')
    ).accessToken;
    const restrictedExchange = (
      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/exchange')
        .set('Authorization', `Bearer ${mallUserToken}`)
        .send({})
        .expect(200)
    ).body as { accessToken: string; permissions: unknown[] };
    expect(restrictedExchange.permissions).toEqual([]);
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/password/initial')
      .set('Authorization', `Bearer ${restrictedExchange.accessToken}`)
      .send({
        temporaryPassword: '222222',
        newPassword: '333333',
        confirmPassword: '333333',
      })
      .expect(200);

    const exchanged = (
      await request(app.getHttpServer())
        .post('/api/v1/admin/auth/exchange')
        .set('Authorization', `Bearer ${mallUserToken}`)
        .send({})
        .expect(200)
    ).body as { accessToken: string; permissions: unknown[] };
    expect(exchanged.permissions).toEqual(OPERATOR_PERMISSIONS);
    await request(app.getHttpServer())
      .get('/api/v1/admin/operator-probe/order-read')
      .set('Authorization', `Bearer ${exchanged.accessToken}`)
      .expect(200)
      .expect({ ok: true });

    const publicAuditCountBefore = await database
      .getRepository(AuditLog)
      .count({
        where: { action: 'ADMIN_PASSWORD_VERIFICATION' },
      });
    const failures = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        request(app.getHttpServer())
          .post('/api/v1/admin/auth/login')
          .send({
            kind: 'OPERATOR',
            phone: user.phone,
            password: `invalid-${index}`,
          }),
      ),
    );
    expect(failures.map(({ status }) => status)).toEqual([
      401, 401, 401, 401, 401,
    ]);
    const operatorBucketId = calculateAdminLoginBucketId(
      ADMIN_SECRET,
      'OPERATOR',
      user.phone!,
    );
    const unknownPhone = findDistinctIdentifier(
      'OPERATOR',
      'unknown-operator',
      new Set([operatorBucketId]),
    );
    const unknownFailures = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        request(app.getHttpServer())
          .post('/api/v1/admin/auth/login')
          .send({
            kind: 'OPERATOR',
            phone: ` ${unknownPhone} `,
            password: `invalid-${index}`,
          }),
      ),
    );
    expect(unknownFailures.map(({ status }) => status)).toEqual([
      401, 401, 401, 401, 401,
    ]);
    expect(unknownFailures.map(({ body }) => body)).toEqual(
      Array.from({ length: 5 }, () => failures[0]?.body),
    );
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({ kind: 'OPERATOR', phone: unknownPhone, password: '000000' })
      .expect(429)
      .expect({
        code: ApiErrorCode.ADMIN_VERIFICATION_RATE_LIMITED,
        message: 'Admin verification rate limited',
      });
    const [unknownBucket, publicAuditCount] = await Promise.all([
      database.getRepository(AdminLoginVerificationBucket).findOneByOrFail({
        bucketId: calculateAdminLoginBucketId(
          ADMIN_SECRET,
          'OPERATOR',
          unknownPhone,
        ),
      }),
      database.getRepository(AuditLog).count({
        where: { action: 'ADMIN_PASSWORD_VERIFICATION' },
      }),
    ]);
    expect(unknownBucket.failedCount).toBe(5);
    expect(publicAuditCount).toBe(publicAuditCountBefore);
    expect(
      await database.getRepository(AdminLoginVerificationBucket).count(),
    ).toBe(1024);
    const serializedUnknownData = JSON.stringify({ unknownBucket });
    expect(serializedUnknownData).not.toContain(unknownPhone);
    expect(serializedUnknownData).not.toContain('identifier');
    expect(serializedUnknownData).not.toContain('phone');
    expect(serializedUnknownData).not.toContain('email');
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({ kind: 'OPERATOR', phone: user.phone, password: '000000' })
      .expect(429);
    expect(
      (
        await database.getRepository(AdminUser).findOneByOrFail({
          linkedUserId: user.id,
        })
      ).verifyFailedCount,
    ).toBe(5);

    const admins = database.getRepository(AdminUser);
    const operatorVersionBefore = (
      await admins.findOneByOrFail({ linkedUserId: user.id })
    ).tokenVersion;
    const identity = app.get(UserIdentityService);
    await identity.setPhoneIdentity({
      userId: user.id,
      phone: '13900000000',
      phoneVerified: false,
    });
    expect(
      (await admins.findOneByOrFail({ linkedUserId: user.id })).tokenVersion,
    ).toBe(operatorVersionBefore + 1);

    await request(app.getHttpServer())
      .get('/api/v1/admin/operator-probe/order-read')
      .set('Authorization', `Bearer ${exchanged.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({ kind: 'OPERATOR', phone: '13900000000', password: '333333' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/exchange')
      .set('Authorization', `Bearer ${mallUserToken}`)
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/operator-probe')
      .set('Authorization', `Bearer ${superVersionToken}`)
      .expect(200);
  });
});
