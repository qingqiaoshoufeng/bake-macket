import 'reflect-metadata';

import {
  AdminRole,
  ApiErrorCode,
  FulfillmentType,
  MemberCreditDirection,
  MemberCreditEntryType,
  MemberCreditGrantStatus,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipStatus,
  MembershipTheme,
  OrderStatus,
} from '@bake-mall/contracts';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { type ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { WechatAuthService } from '../src/auth/wechat-auth.service.js';
import { type AppConfig } from '../src/config/env.schema.js';
import { AddressService } from '../src/customer/address.service.js';
import { CartService } from '../src/customer/cart.service.js';
import { Address } from '../src/database/entities/address.entity.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import {
  AuditActorType,
  AuditLog,
} from '../src/database/entities/audit-log.entity.js';
import { CartItem } from '../src/database/entities/cart-item.entity.js';
import { Category } from '../src/database/entities/category.entity.js';
import * as entities from '../src/database/entities/index.js';
import { MembershipLevel } from '../src/database/entities/membership-level.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import { Sku } from '../src/database/entities/sku.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import {
  WechatCredentialKind,
  WechatCredentialStatus,
  WechatCredentialUse,
} from '../src/database/entities/wechat-credential-use.entity.js';
import { migrationsThrough } from '../src/database/migrations/index.js';
import { UserIdentityMergeService } from '../src/users/user-identity-merge.service.js';
import { UserIdentityService } from '../src/users/user-identity.service.js';
import {
  buildPhoneClaimFingerprint,
  hashWechatCredential,
  WechatPhoneCredentialService,
} from '../src/users/wechat-phone-credential.service.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_identity_merge_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const SECRET = 'fixed-mysql-identity-credential-secret';
const BASE_NOW = new Date('2026-08-04T08:00:00.000Z');
const IDENTITY_MIGRATIONS = migrationsThrough(
  'OrderContactAndAdminLoginPhone1718000000013',
);

type InsertResult = { insertId: number | string };
type Pair = { canonical: User; source: User; phone: string };
type ServiceBundle = {
  identities: UserIdentityService;
  merge: UserIdentityMergeService;
  credential: WechatPhoneCredentialService;
};

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

function deferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function exceptionCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  return typeof response === 'object' && response !== null && 'code' in response
    ? (response as { code?: unknown }).code
    : undefined;
}

function exceptionBody(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  return typeof response === 'object' && response !== null
    ? (response as Record<string, unknown>)
    : undefined;
}

function mysqlErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
}

function insertId(result: unknown): string {
  const id = (result as InsertResult).insertId;
  if (id === undefined) throw new Error('MySQL insert did not return insertId');
  return String(id);
}

function configService(): ConfigService<AppConfig, true> {
  return {
    get: () => ({ JWT_USER_SECRET: SECRET }),
  } as unknown as ConfigService<AppConfig, true>;
}

function servicesFor(
  source: DataSource,
  audit: AuditService = new AuditService(source.getRepository(AuditLog)),
): ServiceBundle {
  const identities = new UserIdentityService(source);
  const merge = new UserIdentityMergeService(source, identities, audit);
  const credential = new WechatPhoneCredentialService(
    source,
    configService(),
    merge,
  );
  return { identities, merge, credential };
}

function customerServicesFor(
  source: DataSource,
  identities: UserIdentityService = new UserIdentityService(source),
) {
  return {
    addresses: new AddressService(
      source,
      source.getRepository(Address),
      identities,
    ),
    carts: new CartService(
      source,
      source.getRepository(CartItem),
      source.getRepository(Sku),
      source.getRepository(Product),
      identities,
    ),
  };
}

function bind(
  service: WechatPhoneCredentialService,
  input: {
    rawCredential: string;
    sourceUserId: string;
    phone: string;
    now?: Date;
  },
) {
  return service.bindVerifiedPhone({
    rawCredential: input.rawCredential,
    sourceUserId: input.sourceUserId,
    normalizedPhone: input.phone,
    now: input.now ?? BASE_NOW,
  });
}

async function createUser(
  source: DataSource,
  overrides: Partial<User> = {},
): Promise<User> {
  const repository = source.getRepository(User);
  return repository.save(
    repository.create({
      wechatOpenid: null,
      wechatUnionid: null,
      nickname: null,
      avatarUrl: null,
      phone: null,
      phoneVerified: false,
      ...overrides,
    }),
  );
}

async function createPair(
  source: DataSource,
  suffix: string,
  overrides: { canonical?: Partial<User>; source?: Partial<User> } = {},
): Promise<Pair> {
  const phone = `138${suffix.padStart(8, '0').slice(-8)}`;
  const canonical = await createUser(source, {
    phone,
    phoneVerified: false,
    nickname: `placeholder-${suffix}`,
    ...overrides.canonical,
  });
  const sourceUser = await createUser(source, {
    wechatOpenid: `openid-${suffix}`,
    wechatUnionid: `unionid-${suffix}`,
    nickname: `source-${suffix}`,
    ...overrides.source,
  });
  return { canonical, source: sourceUser, phone };
}

async function createAddress(
  source: DataSource,
  userId: string,
  suffix: string,
  isDefault = false,
): Promise<Address> {
  const repository = source.getRepository(Address);
  return repository.save(
    repository.create({
      userId,
      recipient: `收件人-${suffix}`,
      phone: '13900000000',
      province: '测试省',
      city: '测试市',
      district: '测试区',
      detail: `测试地址-${suffix}`,
      isDefault,
    }),
  );
}

async function createOperator(
  source: DataSource,
  linkedUserId: string,
): Promise<AdminUser> {
  const repository = source.getRepository(AdminUser);
  return repository.save(
    repository.create({
      username: null,
      role: AdminRole.OPERATOR,
      linkedUserId,
      loginPhone: `137${linkedUserId.padStart(8, '0').slice(-8)}`,
      passwordHash: 'not-used-by-identity-e2e',
      isActive: true,
    }),
  );
}

async function seedCredential(
  source: DataSource,
  input: {
    rawCredential: string;
    sourceUserId: string;
    phone: string;
    status: WechatCredentialStatus;
    expiresAt: Date;
    fingerprintSourceUserId?: string;
    fingerprintPhone?: string;
    claimId?: string;
  },
): Promise<WechatCredentialUse> {
  const repository = source.getRepository(WechatCredentialUse);
  return repository.save(
    repository.create({
      kind: WechatCredentialKind.PHONE,
      credentialHash: hashWechatCredential(input.rawCredential),
      status: input.status,
      expiresAt: input.expiresAt,
      resourceUserId: input.sourceUserId,
      responseSnapshot: {
        version: 1,
        kind: 'CLAIM',
        requestFingerprint: buildPhoneClaimFingerprint({
          secret: SECRET,
          sourceUserId: input.fingerprintSourceUserId ?? input.sourceUserId,
          normalizedPhone: input.fingerprintPhone ?? input.phone,
        }),
        claimId: input.claimId ?? 'seeded-old-claim',
      },
    }),
  );
}

async function auditRows(
  source: DataSource,
  canonicalId: string,
  action = 'USER_IDENTITY_MERGED',
): Promise<AuditLog[]> {
  return source.getRepository(AuditLog).find({
    where: { targetEntity: 'users', targetId: canonicalId, action },
    order: { id: 'ASC' },
  });
}

async function createCatalog(source: DataSource): Promise<[Sku, Sku]> {
  const categories = source.getRepository(Category);
  const category = await categories.save(
    categories.create({ name: '身份合并测试分类', isActive: true }),
  );
  const products = source.getRepository(Product);
  const product = await products.save(
    products.create({
      name: '身份合并测试商品',
      categoryId: category.id,
      detailHtml: '<p>identity merge</p>',
      isActive: true,
    }),
  );
  const skus = source.getRepository(Sku);
  return skus.save(
    ['同款', '不同款'].map((name) =>
      skus.create({
        productId: product.id,
        name,
        attributes: { name },
        priceCents: 100,
        stock: 999,
        isActive: true,
      }),
    ),
  ) as Promise<[Sku, Sku]>;
}

async function createCart(
  source: DataSource,
  userId: string,
  skuId: string,
  quantity: number,
): Promise<CartItem> {
  const repository = source.getRepository(CartItem);
  return repository.save(repository.create({ userId, skuId, quantity }));
}

async function createPurchase(
  source: DataSource,
  userId: string,
  membershipLevelId: string,
  suffix: string,
): Promise<string> {
  return insertId(
    await source.query(
      `INSERT INTO membership_purchase_orders
        (purchase_no, user_id, membership_level_id, level_code, level_name,
         level_rank, price_cents, grant_credit_cents, discount_basis_points,
         valid_days, benefits, theme, badge_text, status, payment_status,
         payment_channel, idempotency_key, request_hash)
       VALUES (?, ?, ?, 'IDENTITY_E2E', '身份测试会员', 100, 1000, 1000,
         9000, 30, JSON_ARRAY(), ?, 'E2E', ?, ?, 'SIMULATED', ?, ?)`,
      [
        `MP${suffix}${randomUUID().replaceAll('-', '').slice(0, 12)}`.slice(
          0,
          32,
        ),
        userId,
        membershipLevelId,
        MembershipTheme.PEARL,
        MembershipPurchaseStatus.PENDING,
        MembershipPaymentStatus.PENDING,
        `identity-${suffix}-${randomUUID()}`,
        'a'.repeat(64),
      ],
    ),
  );
}

describe.sequential(
  'user identity merge and credential state machine (MySQL)',
  () => {
    const rootSql = createDockerRootSqlExecutor();
    let cleanupDatabase: (() => void) | undefined;
    let database: DataSource | undefined;
    let mysqlVersion = '';
    let skuSame: Sku;
    let skuDifferent: Sku;
    let membershipLevelId = '';

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
          migrations: [...IDENTITY_MIGRATIONS],
          migrationsTableName: 'migrations',
          migrationsTransactionMode: 'each',
        });
        await database.initialize();
        await database.runMigrations();
        const versionRows = (await database.query(
          'SELECT VERSION() AS version',
        )) as Array<{ version: string }>;
        mysqlVersion = versionRows[0]?.version ?? '';
        [skuSame, skuDifferent] = await createCatalog(database);
        const levels = database.getRepository(MembershipLevel);
        const level = await levels.save(
          levels.create({
            code: 'IDENTITY_E2E',
            name: '身份测试会员',
            rank: 999,
            priceCents: 1000,
            grantCreditCents: 1000,
            discountBasisPoints: 9000,
            validDays: 30,
            benefits: [],
            theme: MembershipTheme.PEARL,
            badgeText: 'E2E',
            sortOrder: 0,
            isActive: true,
          }),
        );
        membershipLevelId = level.id;
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

    it('runs against real MySQL 8.4 with all migrations through 0014', async () => {
      const source = requireDatabase();
      expect(mysqlVersion).toMatch(/^8\.4\./u);
      const migrations = (await source.query(
        'SELECT name FROM migrations ORDER BY timestamp',
      )) as Array<{ name: string }>;
      expect(migrations.at(-1)?.name).toBe(
        'OrderContactAndAdminLoginPhone1718000000013',
      );
      expect(migrations).toHaveLength(IDENTITY_MIGRATIONS.length);
    });

    it('expired COMPLETED LOGIN fails closed without vendor access, session issuance, or reclaim', async () => {
      const source = requireDatabase();
      const completedUser = await createUser(source, {
        wechatOpenid: `openid-expired-login-${randomUUID()}`,
        tokenVersion: 4,
      });
      const rawCredential = `expired-completed-login-${randomUUID()}`;
      const repository = source.getRepository(WechatCredentialUse);
      const completed = await repository.save(
        repository.create({
          kind: WechatCredentialKind.LOGIN,
          credentialHash: hashWechatCredential(rawCredential),
          status: WechatCredentialStatus.COMPLETED,
          expiresAt: new Date(BASE_NOW.getTime() - 1_000),
          resourceUserId: completedUser.id,
          responseSnapshot: {
            version: 1,
            kind: 'COMPLETED',
            resource: { userId: completedUser.id },
            session: { audience: 'mall-user' },
          },
        }),
      );
      let vendorCalls = 0;
      let issueSessionCalls = 0;
      const bundle = servicesFor(source);
      const auth = new WechatAuthService(
        source,
        {
          exchangeLoginCode: async () => {
            vendorCalls += 1;
            return { openid: 'unexpected', unionid: null };
          },
          exchangePhoneCredential: async () => ({
            phoneNumber: '13800000000',
          }),
        } as never,
        bundle.merge,
        bundle.identities,
        {
          issueSession: () => {
            issueSessionCalls += 1;
            return {
              accessToken: 'unexpected-token',
              expiresAt: BASE_NOW.toISOString(),
            };
          },
        } as never,
      );

      await expect(
        auth.loginWithWechatCode(rawCredential, BASE_NOW),
      ).rejects.toSatisfy(
        (error: unknown) =>
          exceptionCode(error) === ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
      );
      expect(vendorCalls).toBe(0);
      expect(issueSessionCalls).toBe(0);
      await expect(
        repository.findOneByOrFail({ id: completed.id }),
      ).resolves.toMatchObject({
        status: WechatCredentialStatus.COMPLETED,
        expiresAt: new Date(BASE_NOW.getTime() - 1_000),
        resourceUserId: completedUser.id,
        responseSnapshot: completed.responseSnapshot,
      });
    });

    it('different login codes resolving to one OpenID converge on one user and two sessions', async () => {
      const source = requireDatabase();
      const adapter = {
        exchangeLoginCode: async () => ({
          openid: `openid-login-race-${randomUUID()}`,
          unionid: null,
        }),
        exchangePhoneCredential: async () => ({ phoneNumber: '13800000000' }),
      };
      const identity = `openid-login-race-${randomUUID()}`;
      adapter.exchangeLoginCode = async () => ({
        openid: identity,
        unionid: null,
      });
      const bundle = servicesFor(source);
      const sessions = {
        issueSession: (user: User) => ({
          accessToken: `token-${user.id}`,
          expiresAt: BASE_NOW.toISOString(),
        }),
      };
      const auth = new WechatAuthService(
        source,
        adapter as never,
        bundle.merge,
        bundle.identities,
        sessions as never,
      );

      const [first, second] = await Promise.all([
        auth.loginWithWechatCode('different-login-code-a', BASE_NOW),
        auth.loginWithWechatCode('different-login-code-b', BASE_NOW),
      ]);

      expect(first.profile.id).toBe(second.profile.id);
      expect(
        await source.getRepository(User).count({
          where: { wechatOpenid: identity },
        }),
      ).toBe(1);
    });

    it('concurrent first claim has one merge owner and at most a safe replay/in-progress loser', async () => {
      const source = requireDatabase();
      const pair = await createPair(source, '101');
      const { credential } = servicesFor(source);
      const request = {
        rawCredential: 'wx-concurrent-first-claim',
        sourceUserId: pair.source.id,
        phone: pair.phone,
      };

      const outcomes = await Promise.allSettled([
        bind(credential, request),
        bind(credential, request),
      ]);
      const actualOwners = outcomes.filter(
        (
          outcome,
        ): outcome is PromiseFulfilledResult<
          Awaited<ReturnType<typeof bind>>
        > => outcome.status === 'fulfilled' && !outcome.value.replayed,
      );
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      );
      expect(actualOwners).toHaveLength(1);
      expect(
        outcomes.filter(
          (outcome) => outcome.status === 'fulfilled' && outcome.value.replayed,
        ),
      ).toHaveLength(1 - rejected.length);
      expect(rejected.map(({ reason }) => exceptionCode(reason))).toEqual(
        rejected.map(() => ApiErrorCode.WECHAT_CREDENTIAL_IN_PROGRESS),
      );
      expect(
        rejected.map(({ reason }) => mysqlErrorCode(reason)),
      ).not.toContain('ER_LOCK_DEADLOCK');

      const replay = await bind(credential, request);
      expect(replay).toMatchObject({
        canonicalUserId: pair.canonical.id,
        replayed: true,
      });
      const persisted = await source
        .getRepository(WechatCredentialUse)
        .findOneByOrFail({
          credentialHash: hashWechatCredential(request.rawCredential),
        });
      expect(persisted).toMatchObject({
        status: WechatCredentialStatus.COMPLETED,
        resourceUserId: pair.canonical.id,
        responseSnapshot: {
          version: 1,
          kind: 'COMPLETED',
          canonicalUserId: pair.canonical.id,
        },
      });
      expect(JSON.stringify(persisted.responseSnapshot)).not.toMatch(
        /138|phone|token|openid|raw|code/iu,
      );
      expect(await auditRows(source, pair.canonical.id)).toHaveLength(1);
    });

    it('completed fingerprint replays canonical without migration and rejects another source or phone', async () => {
      const source = requireDatabase();
      const pair = await createPair(source, '102');
      const other = await createUser(source);
      const { credential } = servicesFor(source);
      const request = {
        rawCredential: 'wx-completed-replay',
        sourceUserId: pair.source.id,
        phone: pair.phone,
      };
      const first = await bind(credential, request);
      const beforeAudits = await auditRows(source, pair.canonical.id);

      await expect(bind(credential, request)).resolves.toMatchObject({
        canonicalUserId: first.canonicalUserId,
        replayed: true,
      });
      for (const changed of [
        { ...request, sourceUserId: other.id },
        { ...request, phone: '13999991002' },
      ]) {
        await expect(bind(credential, changed)).rejects.toSatisfy(
          (error: unknown) =>
            error instanceof ConflictException &&
            exceptionCode(error) === ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
        );
      }
      expect(await auditRows(source, pair.canonical.id)).toHaveLength(
        beforeAudits.length,
      );
    });

    it.each([
      WechatCredentialStatus.IN_PROGRESS,
      WechatCredentialStatus.FAILED,
    ])(
      'same owner/fingerprint reclaims %s while another fingerprint cannot',
      async (status) => {
        const source = requireDatabase();
        const pair = await createPair(
          source,
          status === WechatCredentialStatus.IN_PROGRESS ? '103' : '104',
        );
        const rawCredential = `wx-reclaim-${status}`;
        await seedCredential(source, {
          rawCredential,
          sourceUserId: pair.source.id,
          phone: pair.phone,
          status,
          expiresAt: new Date(BASE_NOW.getTime() - 1),
        });
        const { credential } = servicesFor(source);

        await expect(
          bind(credential, {
            rawCredential,
            sourceUserId: pair.source.id,
            phone: pair.phone,
          }),
        ).resolves.toMatchObject({
          canonicalUserId: pair.canonical.id,
          replayed: false,
        });

        const other = await createUser(source);
        await expect(
          bind(credential, {
            rawCredential,
            sourceUserId: other.id,
            phone: pair.phone,
          }),
        ).rejects.toSatisfy(
          (error: unknown) =>
            exceptionCode(error) === ApiErrorCode.WECHAT_CREDENTIAL_REPLAYED,
        );
      },
    );

    it('old failed attempt cannot overwrite a newer real claim owner', async () => {
      const source = requireDatabase();
      const pair = await createPair(source, '105');
      const rawCredential = 'wx-old-attempt-isolation';
      const row = await seedCredential(source, {
        rawCredential,
        sourceUserId: pair.source.id,
        phone: pair.phone,
        status: WechatCredentialStatus.IN_PROGRESS,
        expiresAt: new Date(BASE_NOW.getTime() + 60_000),
        claimId: 'new-real-claim',
      });
      const { credential } = servicesFor(source);
      const internal = credential as unknown as {
        markFailed: (
          hash: string,
          fingerprint: string,
          sourceUserId: string,
          claimId: string,
        ) => Promise<void>;
      };

      await internal.markFailed(
        row.credentialHash,
        buildPhoneClaimFingerprint({
          secret: SECRET,
          sourceUserId: pair.source.id,
          normalizedPhone: pair.phone,
        }),
        pair.source.id,
        'old-real-claim',
      );

      await expect(
        source
          .getRepository(WechatCredentialUse)
          .findOneByOrFail({ id: row.id }),
      ).resolves.toMatchObject({
        status: WechatCredentialStatus.IN_PROGRESS,
        responseSnapshot: expect.objectContaining({
          claimId: 'new-real-claim',
        }),
      });
    });

    it('real audit FK failure rolls back merge and COMPLETED, then FAILED safely reclaims', async () => {
      const source = requireDatabase();
      const pair = await createPair(source, '106');
      const address = await createAddress(source, pair.source.id, 'atomic');
      const cart = await createCart(source, pair.source.id, skuSame.id, 2);
      const failingAudit = {
        record: async (
          _entry: unknown,
          manager?: EntityManager,
        ): Promise<AuditLog> => {
          if (!manager) throw new Error('Expected transactional audit manager');
          const repository = manager.getRepository(AuditLog);
          return repository.save(
            repository.create({
              actorType: AuditActorType.USER,
              adminUserId: null,
              userId: '999999999999999999',
              targetEntity: 'users',
              targetId: pair.canonical.id,
              action: 'USER_IDENTITY_MERGED',
              changeSummary: { injected: true },
            }),
          );
        },
      } as unknown as AuditService;
      const failing = servicesFor(source, failingAudit);
      const request = {
        rawCredential: 'wx-atomic-rollback',
        sourceUserId: pair.source.id,
        phone: pair.phone,
      };

      await expect(bind(failing.credential, request)).rejects.toBeDefined();
      const [
        canonicalAfterFailure,
        sourceAfterFailure,
        credentialAfterFailure,
      ] = await Promise.all([
        source.getRepository(User).findOneByOrFail({ id: pair.canonical.id }),
        source.getRepository(User).findOneByOrFail({ id: pair.source.id }),
        source.getRepository(WechatCredentialUse).findOneByOrFail({
          credentialHash: hashWechatCredential(request.rawCredential),
        }),
      ]);
      expect(canonicalAfterFailure).toMatchObject({
        phone: pair.phone,
        phoneVerified: false,
        tokenVersion: 1,
      });
      expect(sourceAfterFailure).toMatchObject({
        isActive: true,
        mergedIntoUserId: null,
        phone: null,
        tokenVersion: 1,
      });
      await expect(
        source.getRepository(Address).findOneByOrFail({ id: address.id }),
      ).resolves.toMatchObject({ userId: pair.source.id });
      await expect(
        source.getRepository(CartItem).findOneByOrFail({ id: cart.id }),
      ).resolves.toMatchObject({ userId: pair.source.id, quantity: 2 });
      expect(credentialAfterFailure.status).toBe(WechatCredentialStatus.FAILED);
      expect(await auditRows(source, pair.canonical.id)).toHaveLength(0);

      const retry = servicesFor(source);
      await expect(bind(retry.credential, request)).resolves.toMatchObject({
        canonicalUserId: pair.canonical.id,
        replayed: false,
      });
      await expect(
        source.getRepository(WechatCredentialUse).findOneByOrFail({
          credentialHash: hashWechatCredential(request.rawCredential),
        }),
      ).resolves.toMatchObject({ status: WechatCredentialStatus.COMPLETED });
    });

    it('keeps placeholder ID, tombstones source, migrates address/cart and writes redacted audit atomically', async () => {
      const source = requireDatabase();
      const pair = await createPair(source, '107');
      const address = await createAddress(source, pair.source.id, 'success');
      const canonicalSame = await createCart(
        source,
        pair.canonical.id,
        skuSame.id,
        4,
      );
      const sourceSame = await createCart(
        source,
        pair.source.id,
        skuSame.id,
        3,
      );
      const sourceDifferent = await createCart(
        source,
        pair.source.id,
        skuDifferent.id,
        2,
      );
      const { credential } = servicesFor(source);

      const result = await bind(credential, {
        rawCredential: 'wx-placeholder-success',
        sourceUserId: pair.source.id,
        phone: pair.phone,
      });
      expect(result).toMatchObject({
        canonicalUserId: pair.canonical.id,
        replayed: false,
        user: { id: pair.canonical.id, phoneVerified: true, tokenVersion: 2 },
      });
      const [canonical, tombstone, movedAddress, carts, audits] =
        await Promise.all([
          source.getRepository(User).findOneByOrFail({ id: pair.canonical.id }),
          source.getRepository(User).findOneByOrFail({ id: pair.source.id }),
          source.getRepository(Address).findOneByOrFail({ id: address.id }),
          source.getRepository(CartItem).find({
            where: { userId: pair.canonical.id },
            order: { skuId: 'ASC' },
          }),
          auditRows(source, pair.canonical.id),
        ]);
      expect(canonical).toMatchObject({
        id: pair.canonical.id,
        phone: pair.phone,
        phoneVerified: true,
        wechatOpenid: pair.source.wechatOpenid,
        wechatUnionid: pair.source.wechatUnionid,
        tokenVersion: 2,
      });
      expect(tombstone).toMatchObject({
        id: pair.source.id,
        phone: null,
        phoneVerified: false,
        wechatOpenid: null,
        wechatUnionid: null,
        isActive: false,
        mergedIntoUserId: pair.canonical.id,
        tokenVersion: 2,
      });
      expect(movedAddress.userId).toBe(pair.canonical.id);
      expect(carts).toEqual([
        expect.objectContaining({ id: canonicalSame.id, quantity: 7 }),
        expect.objectContaining({ id: sourceDifferent.id, quantity: 2 }),
      ]);
      expect(carts.some(({ id }) => id === sourceSame.id)).toBe(false);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.changeSummary).toEqual({
        canonicalUserId: pair.canonical.id,
        sourceUserId: pair.source.id,
        migrated: { addresses: 1, cartItems: 2 },
        operatorChanged: false,
      });
      expect(JSON.stringify(audits[0]?.changeSummary)).not.toMatch(
        /13800000000|13900000000|openid|unionid|测试地址/iu,
      );
    });

    it('合并后确定性保留 canonical 默认，否则保留 source 最小 id 默认', async () => {
      const source = requireDatabase();
      const pair = await createPair(source, '109');
      const canonicalFirst = await createAddress(
        source,
        pair.canonical.id,
        'canonical-first',
        true,
      );
      const canonicalSecond = await createAddress(
        source,
        pair.canonical.id,
        'canonical-second',
        true,
      );
      await createAddress(source, pair.source.id, 'source-first', true);
      await createAddress(source, pair.source.id, 'source-second', true);

      await servicesFor(source).merge.mergeVerifiedPhone({
        authenticatedUserId: pair.source.id,
        normalizedPhone: pair.phone,
      });

      const addresses = await source.getRepository(Address).find({
        where: { userId: pair.canonical.id },
        order: { id: 'ASC' },
      });
      expect(addresses).toHaveLength(4);
      expect(addresses.filter(({ isDefault }) => isDefault)).toEqual([
        expect.objectContaining({ id: canonicalFirst.id }),
      ]);
      expect(
        canonicalFirst.id.localeCompare(canonicalSecond.id, 'en', {
          numeric: true,
        }),
      ).toBeLessThan(0);
      expect(
        await source.getRepository(Address).count({
          where: { userId: pair.source.id },
        }),
      ).toBe(0);

      const fallbackPair = await createPair(source, '110');
      await createAddress(
        source,
        fallbackPair.canonical.id,
        'canonical-non-default',
      );
      const sourceFirst = await createAddress(
        source,
        fallbackPair.source.id,
        'source-first',
        true,
      );
      await createAddress(
        source,
        fallbackPair.source.id,
        'source-second',
        true,
      );

      await servicesFor(source).merge.mergeVerifiedPhone({
        authenticatedUserId: fallbackPair.source.id,
        normalizedPhone: fallbackPair.phone,
      });

      const fallbackDefaults = await source.getRepository(Address).find({
        where: {
          userId: fallbackPair.canonical.id,
          isDefault: true,
        },
        order: { id: 'ASC' },
      });
      expect(fallbackDefaults).toEqual([
        expect.objectContaining({ id: sourceFirst.id }),
      ]);
    });

    it.each([
      {
        kind: 'address create',
        suffix: '401',
        write: async (
          source: DataSource,
          sourceUserId: string,
          _skuId: string,
          identities?: UserIdentityService,
        ) =>
          customerServicesFor(source, identities).addresses.create(
            sourceUserId,
            {
              receiverName: '竞态地址',
              phone: '13900000000',
              province: '测试省',
              city: '测试市',
              district: '测试区',
              detail: 'merge-first',
              isDefault: false,
            },
          ),
        sourceRows: (source: DataSource, userId: string) =>
          source.getRepository(Address).count({ where: { userId } }),
      },
      {
        kind: 'new-SKU cart upsert',
        suffix: '402',
        write: async (
          source: DataSource,
          sourceUserId: string,
          skuId: string,
          identities?: UserIdentityService,
        ) =>
          customerServicesFor(source, identities).carts.upsert(sourceUserId, {
            skuId,
            quantity: 2,
          }),
        sourceRows: (source: DataSource, userId: string) =>
          source.getRepository(CartItem).count({ where: { userId } }),
      },
    ])(
      'merge holds the User lock before $kind, so the late write is rejected and leaves no source row',
      async ({ suffix, write, sourceRows }) => {
        const source = requireDatabase();
        const pair = await createPair(source, suffix);
        const mergeAtAudit = deferred();
        const allowMergeCommit = deferred();
        const audit = new AuditService(source.getRepository(AuditLog));
        const gatedAudit = {
          record: async (
            entry: Parameters<AuditService['record']>[0],
            manager?: EntityManager,
          ) => {
            if (entry.action === 'USER_IDENTITY_MERGED') {
              mergeAtAudit.resolve();
              await allowMergeCommit.promise;
            }
            return audit.record(entry, manager);
          },
        } as AuditService;
        const merge = servicesFor(source, gatedAudit).merge;
        const mergePromise = merge.mergeVerifiedPhone({
          authenticatedUserId: pair.source.id,
          normalizedPhone: pair.phone,
        });
        await mergeAtAudit.promise;
        const writeAttempted = deferred();
        const identities = new UserIdentityService(source);
        const originalAssert =
          identities.assertActiveWriteTarget.bind(identities);
        identities.assertActiveWriteTarget = async (userId, manager) => {
          writeAttempted.resolve();
          return originalAssert(userId, manager);
        };
        const writePromise = write(
          source,
          pair.source.id,
          skuDifferent.id,
          identities,
        );
        const writeOutcome = writePromise.then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason: unknown) => ({ status: 'rejected' as const, reason }),
        );
        await writeAttempted.promise;
        allowMergeCommit.resolve();

        await expect(mergePromise).resolves.toMatchObject({
          userId: pair.canonical.id,
        });
        const outcome = await writeOutcome;
        expect(outcome.status).toBe('rejected');
        expect(
          outcome.status === 'rejected' ? outcome.reason : undefined,
        ).toBeInstanceOf(UnauthorizedException);
        expect(await sourceRows(source, pair.source.id)).toBe(0);
      },
    );

    it.each([
      {
        kind: 'address create',
        suffix: '501',
        write: async (
          source: DataSource,
          sourceUserId: string,
          _skuId: string,
          identities?: UserIdentityService,
        ) =>
          customerServicesFor(source, identities).addresses.create(
            sourceUserId,
            {
              receiverName: '先写地址',
              phone: '13900000000',
              province: '测试省',
              city: '测试市',
              district: '测试区',
              detail: 'write-first',
              isDefault: false,
            },
          ),
        canonicalRows: (source: DataSource, userId: string) =>
          source.getRepository(Address).count({ where: { userId } }),
      },
      {
        kind: 'new-SKU cart upsert',
        suffix: '502',
        write: async (
          source: DataSource,
          sourceUserId: string,
          skuId: string,
          identities?: UserIdentityService,
        ) =>
          customerServicesFor(source, identities).carts.upsert(sourceUserId, {
            skuId,
            quantity: 3,
          }),
        canonicalRows: (source: DataSource, userId: string) =>
          source.getRepository(CartItem).count({ where: { userId } }),
      },
    ])(
      '$kind commits before merge, so merge migrates the row to canonical',
      async ({ suffix, write, canonicalRows }) => {
        const source = requireDatabase();
        const pair = await createPair(source, suffix);

        await write(source, pair.source.id, skuDifferent.id);
        await servicesFor(source).merge.mergeVerifiedPhone({
          authenticatedUserId: pair.source.id,
          normalizedPhone: pair.phone,
        });

        expect(await canonicalRows(source, pair.canonical.id)).toBe(1);
        expect(
          await source.getRepository(Address).count({
            where: { userId: pair.source.id },
          }),
        ).toBe(0);
        expect(
          await source.getRepository(CartItem).count({
            where: { userId: pair.source.id },
          }),
        ).toBe(0);
      },
    );

    it('cart quantity over 99 returns deterministic conflict with complete rollback', async () => {
      const source = requireDatabase();
      const pair = await createPair(source, '108');
      const address = await createAddress(
        source,
        pair.source.id,
        'cart-rollback',
      );
      const canonicalCart = await createCart(
        source,
        pair.canonical.id,
        skuSame.id,
        60,
      );
      const sourceCart = await createCart(
        source,
        pair.source.id,
        skuSame.id,
        40,
      );
      const { merge } = servicesFor(source);

      await expect(
        merge.mergeVerifiedPhone({
          authenticatedUserId: pair.source.id,
          normalizedPhone: pair.phone,
        }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          exceptionCode(error) ===
          ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
      );
      await expect(
        source.getRepository(Address).findOneByOrFail({ id: address.id }),
      ).resolves.toMatchObject({ userId: pair.source.id });
      await expect(
        source
          .getRepository(CartItem)
          .findOneByOrFail({ id: canonicalCart.id }),
      ).resolves.toMatchObject({ userId: pair.canonical.id, quantity: 60 });
      await expect(
        source.getRepository(CartItem).findOneByOrFail({ id: sourceCart.id }),
      ).resolves.toMatchObject({ userId: pair.source.id, quantity: 40 });
      await expect(
        source.getRepository(User).findOneByOrFail({ id: pair.source.id }),
      ).resolves.toMatchObject({ isActive: true, mergedIntoUserId: null });
    });

    it.each([
      'orders',
      'membershipPurchases',
      'memberships',
      'memberAccounts',
      'creditEntries',
      'creditGrants',
      'creditAllocations',
    ] as const)('real financial row %s blocks merge', async (fact) => {
      const source = requireDatabase();
      const pair = await createPair(
        source,
        String(
          200 +
            [
              'orders',
              'membershipPurchases',
              'memberships',
              'memberAccounts',
              'creditEntries',
              'creditGrants',
              'creditAllocations',
            ].indexOf(fact),
        ),
      );
      let purchaseId: string | undefined;
      let accountId: string | undefined;
      let entryId: string | undefined;
      let grantId: string | undefined;

      if (fact === 'orders') {
        await source.query(
          `INSERT INTO orders
          (order_no, user_id, status, fulfillment_type, contact_name,
           contact_phone, pickup_time_text, goods_total_cents,
           membership_discount_cents, credit_applied_cents,
           payable_total_cents, pricing_version)
         VALUES (?, ?, ?, ?, '财务事实', ?, '明天', 100, 0, 0, 100, 1)`,
          [
            `O${randomUUID().replaceAll('-', '').slice(0, 20)}`,
            pair.source.id,
            OrderStatus.NEW,
            FulfillmentType.PICKUP,
            pair.phone,
          ],
        );
      }
      if (
        [
          'membershipPurchases',
          'memberships',
          'creditGrants',
          'creditAllocations',
        ].includes(fact)
      ) {
        purchaseId = await createPurchase(
          source,
          pair.source.id,
          membershipLevelId,
          fact,
        );
      }
      if (fact === 'memberships') {
        await source.query(
          `INSERT INTO user_memberships
          (user_id, purchase_order_id, membership_level_id, level_code,
           level_name, level_rank, discount_basis_points, benefits, theme,
           badge_text, starts_at, ends_at, status)
         VALUES (?, ?, ?, 'IDENTITY_E2E', '身份测试会员', 100, 9000,
           JSON_ARRAY(), ?, 'E2E', ?, ?, ?)`,
          [
            pair.source.id,
            purchaseId,
            membershipLevelId,
            MembershipTheme.PEARL,
            new Date('2026-01-01T00:00:00.000Z'),
            new Date('2027-01-01T00:00:00.000Z'),
            MembershipStatus.ACTIVE,
          ],
        );
      }
      if (
        [
          'memberAccounts',
          'creditEntries',
          'creditGrants',
          'creditAllocations',
        ].includes(fact)
      ) {
        accountId = insertId(
          await source.query(
            'INSERT INTO member_accounts (user_id, available_credit_cents, version) VALUES (?, 100, 1)',
            [pair.source.id],
          ),
        );
      }
      if (['creditEntries', 'creditAllocations'].includes(fact)) {
        entryId = insertId(
          await source.query(
            `INSERT INTO member_credit_entries
            (account_id, direction, type, amount_cents, balance_after_cents,
             reference_type, reference_id, operation_key)
           VALUES (?, ?, ?, 100, 100, 'IDENTITY_E2E', ?, ?)`,
            [
              accountId,
              MemberCreditDirection.CREDIT,
              MemberCreditEntryType.MEMBERSHIP_PURCHASE_GRANT,
              pair.source.id,
              `identity-entry-${randomUUID()}`,
            ],
          ),
        );
      }
      if (['creditGrants', 'creditAllocations'].includes(fact)) {
        grantId = insertId(
          await source.query(
            `INSERT INTO member_credit_grants
            (account_id, purchase_order_id, granted_cents, remaining_cents, status)
           VALUES (?, ?, 100, 100, ?)`,
            [accountId, purchaseId, MemberCreditGrantStatus.ACTIVE],
          ),
        );
      }
      if (fact === 'creditAllocations') {
        await source.query(
          `INSERT INTO member_credit_allocations
          (credit_entry_id, grant_id, amount_cents) VALUES (?, ?, 100)`,
          [entryId, grantId],
        );
      }

      const { merge } = servicesFor(source);
      let rejection: unknown;
      try {
        await merge.mergeVerifiedPhone({
          authenticatedUserId: pair.source.id,
          normalizedPhone: pair.phone,
        });
      } catch (error) {
        rejection = error;
      }
      expect(exceptionCode(rejection)).toBe(
        ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
      );
      const body = exceptionBody(rejection);
      expect(body?.category).toBe('FINANCIAL_FACTS');
      expect(
        (body?.counts as Record<string, number> | undefined)?.[fact],
      ).toBeGreaterThan(0);
      await expect(
        source.getRepository(User).findOneByOrFail({ id: pair.source.id }),
      ).resolves.toMatchObject({ isActive: true, mergedIntoUserId: null });
    });

    it.each(['wechatOpenid', 'wechatUnionid'] as const)(
      '%s conflict rolls back both users',
      async (field) => {
        const source = requireDatabase();
        const suffix = field === 'wechatOpenid' ? '301' : '302';
        const pair = await createPair(source, suffix, {
          canonical: { [field]: `canonical-${field}` },
          source: { [field]: `source-${field}` },
        });
        const { merge } = servicesFor(source);

        await expect(
          merge.mergeVerifiedPhone({
            authenticatedUserId: pair.source.id,
            normalizedPhone: pair.phone,
          }),
        ).rejects.toSatisfy(
          (error: unknown) =>
            exceptionCode(error) === ApiErrorCode.WECHAT_IDENTITY_CONFLICT,
        );
        await expect(
          source.getRepository(User).findOneByOrFail({ id: pair.canonical.id }),
        ).resolves.toMatchObject({
          phoneVerified: false,
          tokenVersion: 1,
          [field]: `canonical-${field}`,
        });
        await expect(
          source.getRepository(User).findOneByOrFail({ id: pair.source.id }),
        ).resolves.toMatchObject({
          isActive: true,
          mergedIntoUserId: null,
          [field]: `source-${field}`,
        });
      },
    );

    it('source OPERATOR alone also fails closed instead of moving authorization to canonical', async () => {
      const source = requireDatabase();
      const pair = await createPair(source, '300');
      const sourceOperator = await createOperator(source, pair.source.id);
      const { merge } = servicesFor(source);

      await expect(
        merge.mergeVerifiedPhone({
          authenticatedUserId: pair.source.id,
          normalizedPhone: pair.phone,
        }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          exceptionCode(error) === ApiErrorCode.ADMIN_USER_CONFLICT,
      );
      await expect(
        source.getRepository(AdminUser).findOneByOrFail({
          id: sourceOperator.id,
        }),
      ).resolves.toMatchObject({
        linkedUserId: pair.source.id,
        isActive: true,
        tokenVersion: 1,
      });
      await expect(
        source.getRepository(User).findOneByOrFail({ id: pair.source.id }),
      ).resolves.toMatchObject({ isActive: true, mergedIntoUserId: null });
    });

    it('canonical and source OPERATOR collision rolls back and uses mapped linkedUserId SQL', async () => {
      const source = requireDatabase();
      const pair = await createPair(source, '303');
      const canonicalOperator = await createOperator(source, pair.canonical.id);
      const sourceOperator = await createOperator(source, pair.source.id);
      const { merge } = servicesFor(source);

      await expect(
        merge.mergeVerifiedPhone({
          authenticatedUserId: pair.source.id,
          normalizedPhone: pair.phone,
        }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          exceptionCode(error) === ApiErrorCode.ADMIN_USER_CONFLICT,
      );
      const operators = await source
        .getRepository(AdminUser)
        .findBy([{ id: canonicalOperator.id }, { id: sourceOperator.id }]);
      expect(operators).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: canonicalOperator.id,
            linkedUserId: pair.canonical.id,
            tokenVersion: 1,
          }),
          expect.objectContaining({
            id: sourceOperator.id,
            linkedUserId: pair.source.id,
            tokenVersion: 1,
          }),
        ]),
      );
    });

    it('same-record phone verification increments tokenVersion and returns canonical user', async () => {
      const source = requireDatabase();
      const user = await createUser(source, {
        wechatOpenid: 'same-record-openid',
      });
      const { credential } = servicesFor(source);

      const result = await bind(credential, {
        rawCredential: 'wx-same-record-phone',
        sourceUserId: user.id,
        phone: '13900000304',
      });
      expect(result).toMatchObject({
        canonicalUserId: user.id,
        replayed: false,
        user: {
          id: user.id,
          phone: '13900000304',
          phoneVerified: true,
          tokenVersion: 2,
        },
      });
      await expect(
        source.getRepository(User).findOneByOrFail({ id: user.id }),
      ).resolves.toMatchObject({ phoneVerified: true, tokenVersion: 2 });
      const audits = await auditRows(source, user.id, 'USER_PHONE_VERIFIED');
      expect(audits).toHaveLength(1);
      expect(audits[0]?.changeSummary).toEqual({
        canonicalUserId: user.id,
        sourceUserId: user.id,
        sameRecord: true,
        operatorChanged: false,
      });
      expect(JSON.stringify(audits[0]?.changeSummary)).not.toMatch(
        /13900000304|phone|openid/iu,
      );
    });

    it('same-record verified phone change leaves the independent linked OPERATOR active', async () => {
      const source = requireDatabase();
      const user = await createUser(source, {
        phone: '13900000307',
        phoneVerified: true,
        wechatOpenid: 'same-record-operator-openid',
      });
      const operator = await createOperator(source, user.id);
      const { merge } = servicesFor(source);

      const result = await merge.withPhoneLock(
        '13900000308',
        ({ mergeVerifiedPhone }) =>
          mergeVerifiedPhone({
            authenticatedUserId: user.id,
            normalizedPhone: '13900000308',
          }),
      );

      expect(result).toMatchObject({
        userId: user.id,
        operatorChanged: false,
        user: {
          id: user.id,
          phone: '13900000308',
          phoneVerified: true,
          tokenVersion: 2,
        },
      });
      await expect(
        source.getRepository(AdminUser).findOneByOrFail({ id: operator.id }),
      ).resolves.toMatchObject({ tokenVersion: 1 });
      const audits = await auditRows(source, user.id, 'USER_PHONE_VERIFIED');
      expect(audits).toHaveLength(1);
      expect(audits[0]?.changeSummary).toEqual({
        canonicalUserId: user.id,
        sourceUserId: user.id,
        sameRecord: true,
        operatorChanged: false,
      });
      expect(JSON.stringify(audits[0]?.changeSummary)).not.toMatch(
        /1390000030[78]|phone|openid/iu,
      );
    });

    it('concurrent owner creation for one phone returns a deterministic ownership loser', async () => {
      const source = requireDatabase();
      const first = await createUser(source, {
        wechatOpenid: 'owner-create-a',
      });
      const second = await createUser(source, {
        wechatOpenid: 'owner-create-b',
      });
      const phone = '13900000305';
      const { merge } = servicesFor(source);

      const outcomes = await Promise.allSettled([
        merge.mergeVerifiedPhone({
          authenticatedUserId: first.id,
          normalizedPhone: phone,
        }),
        merge.mergeVerifiedPhone({
          authenticatedUserId: second.id,
          normalizedPhone: phone,
        }),
      ]);

      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      );
      expect(rejected).toBeDefined();
      expect(mysqlErrorCode(rejected?.reason)).not.toBe('ER_DUP_ENTRY');
      expect(mysqlErrorCode(rejected?.reason)).not.toBe('ER_LOCK_DEADLOCK');
      expect(exceptionBody(rejected?.reason)).toMatchObject({
        code: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
        category: 'PHONE_OWNERSHIP',
      });
      expect(await source.getRepository(User).count({ where: { phone } })).toBe(
        1,
      );
    });

    it('two credentials racing to create one phone owner never leak duplicate-key errors', async () => {
      const source = requireDatabase();
      const first = await createUser(source, {
        wechatOpenid: 'credential-owner-a',
      });
      const second = await createUser(source, {
        wechatOpenid: 'credential-owner-b',
      });
      const phone = '13900000306';
      const { credential } = servicesFor(source);

      const outcomes = await Promise.allSettled([
        bind(credential, {
          rawCredential: 'wx-owner-race-a',
          sourceUserId: first.id,
          phone,
        }),
        bind(credential, {
          rawCredential: 'wx-owner-race-b',
          sourceUserId: second.id,
          phone,
        }),
      ]);

      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      );
      expect(rejected).toBeDefined();
      expect(mysqlErrorCode(rejected?.reason)).not.toBe('ER_DUP_ENTRY');
      expect(mysqlErrorCode(rejected?.reason)).not.toBe('ER_LOCK_DEADLOCK');
      expect(exceptionBody(rejected?.reason)).toMatchObject({
        code: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
        category: 'PHONE_OWNERSHIP',
      });
      expect(await source.getRepository(User).count({ where: { phone } })).toBe(
        1,
      );
    });

    it('different credentials racing for one source/placeholder converge once without deadlock leakage', async () => {
      const source = requireDatabase();
      const pair = await createPair(source, '305');
      const { credential } = servicesFor(source);
      const outcomes = await Promise.allSettled([
        bind(credential, {
          rawCredential: 'wx-placeholder-race-a',
          sourceUserId: pair.source.id,
          phone: pair.phone,
        }),
        bind(credential, {
          rawCredential: 'wx-placeholder-race-b',
          sourceUserId: pair.source.id,
          phone: pair.phone,
        }),
      ]);
      expect(
        outcomes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      );
      expect(rejected).toHaveLength(1);
      expect(
        rejected.map(({ reason }) => mysqlErrorCode(reason)),
      ).not.toContain('ER_LOCK_DEADLOCK');
      const [canonical, tombstone, audits] = await Promise.all([
        source.getRepository(User).findOneByOrFail({ id: pair.canonical.id }),
        source.getRepository(User).findOneByOrFail({ id: pair.source.id }),
        auditRows(source, pair.canonical.id),
      ]);
      expect(canonical).toMatchObject({
        phone: pair.phone,
        phoneVerified: true,
        isActive: true,
        mergedIntoUserId: null,
      });
      expect(tombstone).toMatchObject({
        isActive: false,
        mergedIntoUserId: pair.canonical.id,
      });
      expect(audits).toHaveLength(1);
      expect(
        await source
          .getRepository(User)
          .count({ where: { phone: pair.phone } }),
      ).toBe(1);
    });
  },
);
