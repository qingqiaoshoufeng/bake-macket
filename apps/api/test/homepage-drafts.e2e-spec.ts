import 'reflect-metadata';

import {
  AdminRole,
  ApiErrorCode,
  HomepageDraftStatus,
  HomepageLinkType,
  HomepageSectionType,
  type AdminHomepageDraftListView,
  type AdminHomepageView,
  type HomepageDraftConfig,
} from '@bake-mall/contracts';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  DataSource,
  EntityManager,
  type EntityTarget,
  type ObjectLiteral,
  type Repository,
} from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { JWT_ADMIN_AUDIENCE } from '../src/auth/auth.constants.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import { Category } from '../src/database/entities/category.entity.js';
import { HomepageDraft } from '../src/database/entities/homepage-draft.entity.js';
import { HomepagePage } from '../src/database/entities/homepage-page.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import * as entities from '../src/database/entities/index.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { HomepageModule } from '../src/homepage/homepage.module.js';
import {
  createDockerRootSqlExecutor,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_homepage_drafts_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const ADMIN_SECRET = 'homepage-drafts-admin-secret-for-e2e';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const MALFORMED_UNSIGNED_BIGINT_IDS = ['1abc', '1.0', '01', '0', '-1'] as const;
const OVERFLOW_UNSIGNED_BIGINT_ID = '18446744073709551616';

const changedConfig = (
  source: HomepageDraftConfig,
  title: string,
): HomepageDraftConfig => ({
  ...structuredClone(source),
  customerService: {
    ...structuredClone(source.customerService),
    title,
  },
});

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

function dataSourceWithDraftReadBarrier(
  source: DataSource,
  draftId: string,
  version: number,
): DataSource {
  const bothReadInitialVersion = createBarrier(2);
  return {
    transaction: async <T>(
      operation: (manager: EntityManager) => Promise<T>,
    ): Promise<T> => {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      const manager = decorateManager(runner.manager, (entity, repository) => {
        if (entity !== HomepageDraft) return repository;
        return new Proxy(repository, {
          get(target, property, receiver) {
            if (property !== 'findOneBy') {
              return Reflect.get(target, property, receiver);
            }
            return async (where: { id?: string }) => {
              const draft = await (
                target as unknown as Repository<HomepageDraft>
              ).findOneBy(where);
              if (where.id === draftId && draft?.version === version) {
                await bothReadInitialVersion.wait();
              }
              return draft;
            };
          },
        });
      });
      try {
        const result = await operation(manager);
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

const publishableConfig = (
  source: HomepageDraftConfig,
): HomepageDraftConfig => ({
  ...structuredClone(source),
  hero: {
    ...structuredClone(source.hero),
    slides: [
      {
        id: 'strict-hero-slide',
        image: {
          objectKey: 'homepage/strict-hero-slide.jpg',
          publicUrl:
            'http://127.0.0.1:43900/bake-mall/homepage/strict-hero-slide.jpg',
        },
        title: '',
        subtitle: '',
        altText: '',
        link: { type: HomepageLinkType.NONE },
      },
    ],
  },
  customerService: {
    ...structuredClone(source.customerService),
    phone: '13800000000',
    serviceHours: '09:00-18:00',
    wechatQrCode: {
      objectKey: 'homepage/strict-customer-service.jpg',
      publicUrl:
        'http://127.0.0.1:43900/bake-mall/homepage/strict-customer-service.jpg',
    },
  },
  shortcutGrid: {
    ...structuredClone(source.shortcutGrid),
    items: Array.from({ length: source.shortcutGrid.layout }, (_, index) => ({
      id: `strict-shortcut-${index + 1}`,
      label: `入口 ${index + 1}`,
      image: {
        objectKey: `homepage/strict-shortcut-${index + 1}.jpg`,
        publicUrl: `http://127.0.0.1:43900/bake-mall/homepage/strict-shortcut-${index + 1}.jpg`,
      },
      link: { type: HomepageLinkType.NONE },
    })),
  },
  imageBlocks: [
    {
      id: 'strict-image-block',
      type: HomepageSectionType.IMAGE_BLOCK,
      enabled: true,
      image: {
        objectKey: 'homepage/strict-image-block.jpg',
        publicUrl:
          'http://127.0.0.1:43900/bake-mall/homepage/strict-image-block.jpg',
      },
      title: '',
      description: '',
      altText: '',
      link: { type: HomepageLinkType.NONE },
    },
  ],
});

describe.sequential('Admin homepage drafts (e2e)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let app: INestApplication | undefined;
  let dataSource: DataSource;
  let adminId = '';
  let adminToken = '';
  let initialDraft: HomepageDraft;
  let blankDraft: AdminHomepageView;
  let copiedDraft: AdminHomepageView;

  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  beforeAll(async () => {
    cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              appEnv: {
                NODE_ENV: 'test',
                JWT_ADMIN_SECRET: ADMIN_SECRET,
                OBJECT_STORAGE_PUBLIC_BASE_URL:
                  'http://127.0.0.1:43900/bake-mall',
                PRODUCT_MEDIA_ALLOWED_ORIGINS: ['http://127.0.0.1:43900'],
              },
            }),
          ],
        }),
        JwtModule.register({ global: true }),
        TypeOrmModule.forRoot({
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
          migrationsRun: true,
          retryAttempts: 1,
        }),
        HomepageModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    const adminUser = await dataSource.getRepository(AdminUser).save(
      dataSource.getRepository(AdminUser).create({
        username: `homepage-admin-${process.pid}`,
        role: AdminRole.SUPER_ADMIN,
        linkedUserId: null,
        passwordHash: 'test-only',
        isActive: true,
        mustChangePassword: false,
        tokenVersion: 1,
      }),
    );
    adminId = adminUser.id;
    adminToken = await app.get(JwtService).signAsync(
      {
        sub: adminId,
        aud: JWT_ADMIN_AUDIENCE,
        role: AdminRole.SUPER_ADMIN,
        tokenVersion: 1,
        linkedUserId: null,
        mustChangePassword: false,
      },
      { secret: ADMIN_SECRET, expiresIn: 3_600 },
    );
    initialDraft = (await dataSource.getRepository(HomepageDraft).findOneBy({
      name: '当前首页',
    })) as HomepageDraft;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    cleanupDatabase?.();
  }, 60_000);

  it('requires an admin JWT for the draft collection', async () => {
    await request(app!.getHttpServer())
      .get('/api/v1/admin/homepage/drafts')
      .expect(401);
  });

  it('rejects unknown fields and invalid COPY/BLANK source combinations', async () => {
    await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({ name: '非法空白', mode: 'BLANK', sourceDraftId: initialDraft.id })
      .expect(400);
    await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({ name: '非法复制', mode: 'COPY' })
      .expect(400);
    await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({ name: '非法字段', mode: 'BLANK', unexpected: true })
      .expect(400);
  });

  it('rejects malformed COPY source ids without copying an existing draft', async () => {
    const drafts = dataSource.getRepository(HomepageDraft);
    const before = await drafts.findOneByOrFail({ id: initialDraft.id });
    const draftCountBefore = await drafts.count();

    for (const sourceDraftId of [
      ...MALFORMED_UNSIGNED_BIGINT_IDS,
      OVERFLOW_UNSIGNED_BIGINT_ID,
    ]) {
      await request(app!.getHttpServer())
        .post('/api/v1/admin/homepage/drafts')
        .set(admin())
        .send({
          name: `非法来源 ${sourceDraftId}`,
          mode: 'COPY',
          sourceDraftId,
        })
        .expect(400);
    }

    const after = await drafts.findOneByOrFail({ id: initialDraft.id });
    expect(await drafts.count()).toBe(draftCountBefore);
    expect(after).toMatchObject({
      name: before.name,
      version: before.version,
      draftConfig: before.draftConfig,
    });
  });

  it('rejects malformed path ids before reading or mutating an existing draft', async () => {
    const drafts = dataSource.getRepository(HomepageDraft);
    const pages = dataSource.getRepository(HomepagePage);
    const before = await drafts.findOneByOrFail({ id: initialDraft.id });
    const pageBefore = await pages.findOneByOrFail({ pageKey: 'HOME' });
    const pathIds = [
      ...MALFORMED_UNSIGNED_BIGINT_IDS,
      OVERFLOW_UNSIGNED_BIGINT_ID,
    ];

    for (const id of pathIds) {
      await request(app!.getHttpServer())
        .get(`/api/v1/admin/homepage/drafts/${id}`)
        .set(admin())
        .expect(400);
      await request(app!.getHttpServer())
        .put(`/api/v1/admin/homepage/drafts/${id}`)
        .set(admin())
        .send({
          config: changedConfig(before.draftConfig, `非法保存 ${id}`),
          version: before.version,
        })
        .expect(400);
      await request(app!.getHttpServer())
        .patch(`/api/v1/admin/homepage/drafts/${id}`)
        .set(admin())
        .send({ name: `非法重命名 ${id}`, version: before.version })
        .expect(400);
      await request(app!.getHttpServer())
        .delete(`/api/v1/admin/homepage/drafts/${id}`)
        .set(admin())
        .expect(400);
      await request(app!.getHttpServer())
        .post(`/api/v1/admin/homepage/drafts/${id}/publish`)
        .set(admin())
        .send({ version: before.version })
        .expect(400);
    }

    const after = await drafts.findOneByOrFail({ id: initialDraft.id });
    const pageAfter = await pages.findOneByOrFail({ pageKey: 'HOME' });
    expect(after).toMatchObject({
      name: before.name,
      version: before.version,
      draftConfig: before.draftConfig,
    });
    expect(pageAfter).toMatchObject({
      publishedConfig: pageBefore.publishedConfig,
      publishedVersion: pageBefore.publishedVersion,
      publishedDraftId: pageBefore.publishedDraftId,
      publishedDraftVersion: pageBefore.publishedDraftVersion,
    });
  });

  it('creates a trimmed BLANK draft from the API domain blank config', async () => {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({ name: '  空白方案  ', mode: 'BLANK' })
      .expect(201);

    blankDraft = response.body as AdminHomepageView;
    expect(blankDraft).toMatchObject({
      name: '空白方案',
      status: HomepageDraftStatus.DRAFT,
      version: 1,
      updatedByAdminId: adminId,
      draftConfig: {
        schemaVersion: 1,
        hero: {
          id: 'hero',
          type: HomepageSectionType.HERO_CAROUSEL,
          slides: [],
        },
        customerService: { phone: '', serviceHours: '', wechatQrCode: null },
        shortcutGrid: { items: [] },
        imageBlocks: [],
      },
    });
  });

  it('creates a COPY with a deep-cloned source config', async () => {
    const response = await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({
        name: '复制方案',
        mode: 'COPY',
        sourceDraftId: initialDraft.id,
      })
      .expect(201);

    copiedDraft = response.body as AdminHomepageView;
    expect(copiedDraft).toMatchObject({
      name: '复制方案',
      status: HomepageDraftStatus.DRAFT,
      version: 1,
      draftConfig: initialDraft.draftConfig,
    });

    const changed = changedConfig(copiedDraft.draftConfig, '只改副本');
    await request(app!.getHttpServer())
      .put(`/api/v1/admin/homepage/drafts/${copiedDraft.id}`)
      .set(admin())
      .send({ config: changed, version: copiedDraft.version })
      .expect(200);
    const source = await request(app!.getHttpServer())
      .get(`/api/v1/admin/homepage/drafts/${initialDraft.id}`)
      .set(admin())
      .expect(200);
    expect(source.body.draftConfig.customerService.title).not.toBe('只改副本');
    copiedDraft = { ...copiedDraft, draftConfig: changed, version: 2 };
  });

  it('lists drafts with stable updatedAt DESC, id DESC pagination and derived status', async () => {
    const page = (await dataSource.getRepository(HomepagePage).findOneBy({
      pageKey: 'HOME',
    })) as HomepagePage;
    await dataSource.getRepository(HomepagePage).update(page.id, {
      publishedDraftId: copiedDraft.id,
      publishedDraftVersion: copiedDraft.version,
    });
    await dataSource
      .getRepository(HomepageDraft)
      .createQueryBuilder()
      .update(HomepageDraft)
      .set({ updatedAt: new Date('2026-08-01T12:00:00.000Z') })
      .execute();

    const response = await request(app!.getHttpServer())
      .get('/api/v1/admin/homepage/drafts?page=1&pageSize=2')
      .set(admin())
      .expect(200);
    const list = response.body as AdminHomepageDraftListView;
    const expectedIds = [initialDraft.id, blankDraft.id, copiedDraft.id]
      .sort((left, right) => (BigInt(left) > BigInt(right) ? -1 : 1))
      .slice(0, 2);
    expect(list).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 3,
      publishedDraftId: copiedDraft.id,
    });
    expect(list.items.map(({ id }) => id)).toEqual(expectedIds);
    expect(list.items.find(({ id }) => id === copiedDraft.id)?.status).toBe(
      HomepageDraftStatus.PUBLISHED,
    );

    await dataSource
      .getRepository(HomepageDraft)
      .increment({ id: copiedDraft.id }, 'version', 1);
    copiedDraft.version += 1;
    const changedList = await request(app!.getHttpServer())
      .get('/api/v1/admin/homepage/drafts?page=1&pageSize=20')
      .set(admin())
      .expect(200);
    expect(
      (changedList.body as AdminHomepageDraftListView).items.find(
        ({ id }) => id === copiedDraft.id,
      )?.status,
    ).toBe(HomepageDraftStatus.PUBLISHED_WITH_CHANGES);
  });

  it('gets a draft by id and maps missing ids to HOMEPAGE_DRAFT_NOT_FOUND', async () => {
    const found = await request(app!.getHttpServer())
      .get(`/api/v1/admin/homepage/drafts/${blankDraft.id}`)
      .set(admin())
      .expect(200);
    expect(found.body).toMatchObject({ id: blankDraft.id, name: '空白方案' });

    const missing = await request(app!.getHttpServer())
      .get('/api/v1/admin/homepage/drafts/999999999999')
      .set(admin())
      .expect(404);
    expect(missing.body.code).toBe(ApiErrorCode.HOMEPAGE_DRAFT_NOT_FOUND);
  });

  it('returns the committed version after overlapping saves conflict', async () => {
    const created = await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({ name: '并发保存', mode: 'BLANK' })
      .expect(201);
    const existing = created.body as AdminHomepageView;
    const barrierDataSource = dataSourceWithDraftReadBarrier(
      dataSource,
      existing.id,
      existing.version,
    );
    const transaction = vi
      .spyOn(dataSource, 'transaction')
      .mockImplementation((<T>(
        operation: (manager: EntityManager) => Promise<T>,
      ) =>
        barrierDataSource.transaction(operation)) as DataSource['transaction']);

    try {
      const responses = await Promise.all([
        request(app!.getHttpServer())
          .put(`/api/v1/admin/homepage/drafts/${existing.id}`)
          .set(admin())
          .send({
            config: changedConfig(existing.draftConfig, '并发保存 A'),
            version: existing.version,
          }),
        request(app!.getHttpServer())
          .put(`/api/v1/admin/homepage/drafts/${existing.id}`)
          .set(admin())
          .send({
            config: changedConfig(existing.draftConfig, '并发保存 B'),
            version: existing.version,
          }),
      ]);
      const succeeded = responses.find(({ status }) => status === 200);
      const conflicted = responses.find(({ status }) => status === 409);
      const persisted = await dataSource
        .getRepository(HomepageDraft)
        .findOneByOrFail({ id: existing.id });

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(conflicted?.body).toMatchObject({
        code: ApiErrorCode.HOMEPAGE_VERSION_CONFLICT,
        details: { currentVersion: existing.version + 1 },
      });
      expect(persisted).toMatchObject({
        version: existing.version + 1,
        draftConfig: succeeded?.body.draftConfig,
      });
    } finally {
      transaction.mockRestore();
    }
  });

  it('returns the committed version after overlapping renames conflict', async () => {
    const created = await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({ name: '并发重命名', mode: 'BLANK' })
      .expect(201);
    const existing = created.body as AdminHomepageView;
    const barrierDataSource = dataSourceWithDraftReadBarrier(
      dataSource,
      existing.id,
      existing.version,
    );
    const transaction = vi
      .spyOn(dataSource, 'transaction')
      .mockImplementation((<T>(
        operation: (manager: EntityManager) => Promise<T>,
      ) =>
        barrierDataSource.transaction(operation)) as DataSource['transaction']);

    try {
      const responses = await Promise.all([
        request(app!.getHttpServer())
          .patch(`/api/v1/admin/homepage/drafts/${existing.id}`)
          .set(admin())
          .send({ name: '并发重命名 A', version: existing.version }),
        request(app!.getHttpServer())
          .patch(`/api/v1/admin/homepage/drafts/${existing.id}`)
          .set(admin())
          .send({ name: '并发重命名 B', version: existing.version }),
      ]);
      const succeeded = responses.find(({ status }) => status === 200);
      const conflicted = responses.find(({ status }) => status === 409);
      const persisted = await dataSource
        .getRepository(HomepageDraft)
        .findOneByOrFail({ id: existing.id });

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(conflicted?.body).toMatchObject({
        code: ApiErrorCode.HOMEPAGE_VERSION_CONFLICT,
        details: { currentVersion: existing.version + 1 },
      });
      expect(persisted).toMatchObject({
        name: succeeded?.body.name,
        version: existing.version + 1,
      });
    } finally {
      transaction.mockRestore();
    }
  });

  it('saves only the addressed draft and rejects a stale version', async () => {
    const beforeOther = await dataSource
      .getRepository(HomepageDraft)
      .findOneByOrFail({ id: copiedDraft.id });
    const nextConfig = changedConfig(blankDraft.draftConfig, '仅修改 A');
    const saved = await request(app!.getHttpServer())
      .put(`/api/v1/admin/homepage/drafts/${blankDraft.id}`)
      .set(admin())
      .send({ config: nextConfig, version: blankDraft.version })
      .expect(200);
    expect(saved.body).toMatchObject({
      id: blankDraft.id,
      version: blankDraft.version + 1,
      draftConfig: nextConfig,
    });
    const afterOther = await dataSource
      .getRepository(HomepageDraft)
      .findOneByOrFail({ id: copiedDraft.id });
    expect(afterOther.draftConfig).toEqual(beforeOther.draftConfig);
    expect(afterOther.version).toBe(beforeOther.version);

    const stale = await request(app!.getHttpServer())
      .put(`/api/v1/admin/homepage/drafts/${blankDraft.id}`)
      .set(admin())
      .send({ config: nextConfig, version: blankDraft.version })
      .expect(409);
    expect(stale.body.code).toBe(ApiErrorCode.HOMEPAGE_VERSION_CONFLICT);
    blankDraft = saved.body as AdminHomepageView;
  });

  it('rejects unknown keys at every config object depth without changing drafts', async () => {
    const invalidConfigs = [
      (config: HomepageDraftConfig) =>
        Object.assign(config, { unexpected: 'root-secret' }),
      (config: HomepageDraftConfig) =>
        Object.assign(config.hero, { unexpected: 'hero-section-secret' }),
      (config: HomepageDraftConfig) =>
        Object.assign(config.customerService, {
          unexpected: 'customer-service-secret',
        }),
      (config: HomepageDraftConfig) =>
        Object.assign(config.shortcutGrid, {
          unexpected: 'shortcut-grid-secret',
        }),
      (config: HomepageDraftConfig) => {
        const complete = publishableConfig(config);
        Object.assign(complete.imageBlocks[0]!, {
          unexpected: 'image-block-secret',
        });
        return complete;
      },
      (config: HomepageDraftConfig) => {
        const complete = publishableConfig(config);
        Object.assign(complete.hero.slides[0]!, {
          unexpected: 'hero-slide-secret',
        });
        return complete;
      },
      (config: HomepageDraftConfig) => {
        const complete = publishableConfig(config);
        Object.assign(complete.shortcutGrid.items[0]!, {
          unexpected: 'shortcut-item-secret',
        });
        return complete;
      },
      (config: HomepageDraftConfig) => {
        config.customerService.wechatQrCode = Object.assign(
          {
            objectKey: 'homepage/customer-service-strict.jpg',
            publicUrl:
              'http://127.0.0.1:43900/bake-mall/homepage/customer-service-strict.jpg',
          },
          { privateUrl: 'http://private.example.test/customer-service.jpg' },
        );
        return config;
      },
    ];
    const results: Array<{
      status: number;
      before: HomepageDraft;
      after: HomepageDraft;
    }> = [];

    for (const [index, makeInvalid] of invalidConfigs.entries()) {
      const created = await request(app!.getHttpServer())
        .post('/api/v1/admin/homepage/drafts')
        .set(admin())
        .send({ name: `严格校验 ${index + 1}`, mode: 'BLANK' })
        .expect(201);
      const before = await dataSource
        .getRepository(HomepageDraft)
        .findOneByOrFail({ id: created.body.id as string });
      const response = await request(app!.getHttpServer())
        .put(`/api/v1/admin/homepage/drafts/${before.id}`)
        .set(admin())
        .send({
          config: makeInvalid(structuredClone(before.draftConfig)),
          version: before.version,
        });
      const after = await dataSource
        .getRepository(HomepageDraft)
        .findOneByOrFail({ id: before.id });
      results.push({ status: response.status, before, after });
    }

    expect(results.map(({ status }) => status)).toEqual(
      invalidConfigs.map(() => 400),
    );
    for (const { before, after } of results) {
      expect(after.version).toBe(before.version);
      expect(after.draftConfig).toEqual(before.draftConfig);
    }
  });

  it('strictly validates stored configs before COPY creation and publication', async () => {
    const drafts = dataSource.getRepository(HomepageDraft);
    const pages = dataSource.getRepository(HomepagePage);
    const source = await drafts.findOneByOrFail({ id: copiedDraft.id });
    const malformed = Object.assign(publishableConfig(source.draftConfig), {
      unexpected: 'stored-secret',
    });
    await drafts.update(source.id, { draftConfig: malformed });
    const draftCountBeforeCopy = await drafts.count();

    const copyResponse = await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({
        name: '非法来源副本',
        mode: 'COPY',
        sourceDraftId: source.id,
      });
    const draftCountAfterCopy = await drafts.count();
    const pageBeforePublish = await pages.findOneByOrFail({ pageKey: 'HOME' });
    const publishResponse = await request(app!.getHttpServer())
      .post(`/api/v1/admin/homepage/drafts/${source.id}/publish`)
      .set(admin())
      .send({ version: source.version });
    const pageAfterPublish = await pages.findOneByOrFail({ pageKey: 'HOME' });

    await drafts.update(source.id, { draftConfig: source.draftConfig });
    if (copyResponse.body.id) {
      await drafts.delete({ id: copyResponse.body.id as string });
    }

    expect(copyResponse.status).toBe(400);
    expect(draftCountAfterCopy).toBe(draftCountBeforeCopy);
    expect(publishResponse.status).toBe(400);
    expect(pageAfterPublish).toMatchObject({
      publishedConfig: pageBeforePublish.publishedConfig,
      publishedVersion: pageBeforePublish.publishedVersion,
      publishedDraftId: pageBeforePublish.publishedDraftId,
      publishedDraftVersion: pageBeforePublish.publishedDraftVersion,
    });
  });

  it('keeps save DTO strict and validates homepage media ownership', async () => {
    await request(app!.getHttpServer())
      .put(`/api/v1/admin/homepage/drafts/${blankDraft.id}`)
      .set(admin())
      .send({
        config: blankDraft.draftConfig,
        version: blankDraft.version,
        name: '不能夹带重命名',
      })
      .expect(400);

    const invalidMedia = structuredClone(blankDraft.draftConfig);
    invalidMedia.hero.slides = [
      {
        id: 'invalid-media',
        image: {
          objectKey: 'products/not-homepage.jpg',
          publicUrl:
            'http://127.0.0.1:43900/bake-mall/products/not-homepage.jpg',
        },
        title: '',
        subtitle: '',
        altText: '',
        link: { type: HomepageLinkType.NONE },
      },
    ];
    const response = await request(app!.getHttpServer())
      .put(`/api/v1/admin/homepage/drafts/${blankDraft.id}`)
      .set(admin())
      .send({ config: invalidMedia, version: blankDraft.version })
      .expect(422);
    expect(response.body.code).toBe(
      ApiErrorCode.HOMEPAGE_ASSET_OWNERSHIP_INVALID,
    );
  });

  it('renames with optimistic concurrency and maps duplicate names to 409', async () => {
    const renamed = await request(app!.getHttpServer())
      .patch(`/api/v1/admin/homepage/drafts/${blankDraft.id}`)
      .set(admin())
      .send({ name: '  重命名方案  ', version: blankDraft.version })
      .expect(200);
    expect(renamed.body).toMatchObject({
      name: '重命名方案',
      version: blankDraft.version + 1,
    });
    blankDraft = renamed.body as AdminHomepageView;

    const duplicate = await request(app!.getHttpServer())
      .patch(`/api/v1/admin/homepage/drafts/${blankDraft.id}`)
      .set(admin())
      .send({ name: copiedDraft.name, version: blankDraft.version })
      .expect(409);
    expect(duplicate.body.code).toBe(ApiErrorCode.HOMEPAGE_DRAFT_NAME_CONFLICT);
  });

  it('maps missing save and rename targets to HOMEPAGE_DRAFT_NOT_FOUND', async () => {
    const saveMissing = await request(app!.getHttpServer())
      .put('/api/v1/admin/homepage/drafts/999999999999')
      .set(admin())
      .send({ config: blankDraft.draftConfig, version: 1 })
      .expect(404);
    expect(saveMissing.body.code).toBe(ApiErrorCode.HOMEPAGE_DRAFT_NOT_FOUND);

    const renameMissing = await request(app!.getHttpServer())
      .patch('/api/v1/admin/homepage/drafts/999999999999')
      .set(admin())
      .send({ name: '不存在', version: 1 })
      .expect(404);
    expect(renameMissing.body.code).toBe(ApiErrorCode.HOMEPAGE_DRAFT_NOT_FOUND);
  });

  it('publishes addressed drafts as isolated public snapshots and switches derived status', async () => {
    const drafts = dataSource.getRepository(HomepageDraft);
    const pages = dataSource.getRepository(HomepagePage);
    const createPublishableDraft = async (
      name: string,
      title: string,
    ): Promise<AdminHomepageView> => {
      const created = await request(app!.getHttpServer())
        .post('/api/v1/admin/homepage/drafts')
        .set(admin())
        .send({ name, mode: 'BLANK' })
        .expect(201);
      const config = changedConfig(
        publishableConfig((created.body as AdminHomepageView).draftConfig),
        title,
      );
      const saved = await request(app!.getHttpServer())
        .put(`/api/v1/admin/homepage/drafts/${created.body.id as string}`)
        .set(admin())
        .send({ config, version: created.body.version as number })
        .expect(200);
      return saved.body as AdminHomepageView;
    };
    let draftA = await createPublishableDraft('发布方案 A', '已发布 A');
    const draftB = await createPublishableDraft('发布方案 B', '已发布 B');
    const pageBefore = await pages.findOneByOrFail({ pageKey: 'HOME' });

    const publishedA = await request(app!.getHttpServer())
      .post(`/api/v1/admin/homepage/drafts/${draftA.id}/publish`)
      .set(admin())
      .send({ version: draftA.version })
      .expect(201);
    const pageAfterA = await pages.findOneByOrFail({ pageKey: 'HOME' });
    const draftAfterPublish = await drafts.findOneByOrFail({ id: draftA.id });
    const publicA = await request(app!.getHttpServer())
      .get('/api/v1/public/homepage')
      .expect(200);

    expect(publishedA.body).toMatchObject({
      id: draftA.id,
      name: draftA.name,
      status: HomepageDraftStatus.PUBLISHED,
      version: draftA.version,
      publishedVersion: (pageBefore.publishedVersion ?? 0) + 1,
    });
    expect(draftAfterPublish.version).toBe(draftA.version);
    expect(pageAfterA).toMatchObject({
      publishedConfig: draftA.draftConfig,
      publishedDraftId: draftA.id,
      publishedDraftVersion: draftA.version,
      publishedVersion: (pageBefore.publishedVersion ?? 0) + 1,
      publishedByAdminId: adminId,
    });
    expect(publicA.body).toMatchObject({
      publishedVersion: pageAfterA.publishedVersion,
      config: {
        customerService: { title: '已发布 A' },
      },
    });

    const changedAConfig = changedConfig(draftA.draftConfig, 'A 未发布修改');
    const savedA = await request(app!.getHttpServer())
      .put(`/api/v1/admin/homepage/drafts/${draftA.id}`)
      .set(admin())
      .send({ config: changedAConfig, version: draftA.version })
      .expect(200);
    draftA = savedA.body as AdminHomepageView;
    const listAfterSave = await request(app!.getHttpServer())
      .get('/api/v1/admin/homepage/drafts?page=1&pageSize=100')
      .set(admin())
      .expect(200);
    const publicAfterSave = await request(app!.getHttpServer())
      .get('/api/v1/public/homepage')
      .expect(200);

    expect(
      (listAfterSave.body as AdminHomepageDraftListView).items.find(
        ({ id }) => id === draftA.id,
      )?.status,
    ).toBe(HomepageDraftStatus.PUBLISHED_WITH_CHANGES);
    expect(publicAfterSave.body).toEqual(publicA.body);

    const publishedB = await request(app!.getHttpServer())
      .post(`/api/v1/admin/homepage/drafts/${draftB.id}/publish`)
      .set(admin())
      .send({ version: draftB.version })
      .expect(201);
    const pageAfterB = await pages.findOneByOrFail({ pageKey: 'HOME' });
    const listAfterB = await request(app!.getHttpServer())
      .get('/api/v1/admin/homepage/drafts?page=1&pageSize=100')
      .set(admin())
      .expect(200);
    const publicB = await request(app!.getHttpServer())
      .get('/api/v1/public/homepage')
      .expect(200);

    expect(publishedB.body).toMatchObject({
      id: draftB.id,
      name: draftB.name,
      status: HomepageDraftStatus.PUBLISHED,
      version: draftB.version,
      publishedVersion: pageAfterA.publishedVersion! + 1,
    });
    expect(pageAfterB).toMatchObject({
      publishedConfig: draftB.draftConfig,
      publishedDraftId: draftB.id,
      publishedDraftVersion: draftB.version,
      publishedVersion: pageAfterA.publishedVersion! + 1,
    });
    expect(
      (listAfterB.body as AdminHomepageDraftListView).items.find(
        ({ id }) => id === draftA.id,
      )?.status,
    ).toBe(HomepageDraftStatus.DRAFT);
    expect(
      (listAfterB.body as AdminHomepageDraftListView).items.find(
        ({ id }) => id === draftB.id,
      )?.status,
    ).toBe(HomepageDraftStatus.PUBLISHED);
    expect(publicB.body).toMatchObject({
      publishedVersion: pageAfterB.publishedVersion,
      config: { customerService: { title: '已发布 B' } },
    });
  });

  it('rolls back invalid addressed publications and keeps public responses private', async () => {
    const pages = dataSource.getRepository(HomepagePage);
    const drafts = dataSource.getRepository(HomepageDraft);
    const pageBefore = await pages.findOneByOrFail({ pageKey: 'HOME' });
    const publicBefore = await request(app!.getHttpServer())
      .get('/api/v1/public/homepage')
      .expect(200);
    const created = await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({ name: 'private-name-13800000000', mode: 'BLANK' })
      .expect(201);
    const invalidDraft = await drafts.findOneByOrFail({
      id: created.body.id as string,
    });

    const invalid = await request(app!.getHttpServer())
      .post(`/api/v1/admin/homepage/drafts/${invalidDraft.id}/publish`)
      .set(admin())
      .send({ version: invalidDraft.version })
      .expect(422);
    const pageAfter = await pages.findOneByOrFail({ pageKey: 'HOME' });
    const publicAfter = await request(app!.getHttpServer())
      .get('/api/v1/public/homepage')
      .expect(200);
    const publicJson = JSON.stringify(publicAfter.body);

    expect(invalid.body).toMatchObject({
      code: ApiErrorCode.HOMEPAGE_PUBLISH_INVALID,
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'HERO_EMPTY',
            sectionId: invalidDraft.draftConfig.hero.id,
            field: 'slides',
          }),
        ]),
      },
    });
    expect(pageAfter).toMatchObject({
      publishedConfig: pageBefore.publishedConfig,
      publishedVersion: pageBefore.publishedVersion,
      publishedDraftId: pageBefore.publishedDraftId,
      publishedDraftVersion: pageBefore.publishedDraftVersion,
      publishedByAdminId: pageBefore.publishedByAdminId,
      publishedAt: pageBefore.publishedAt,
    });
    expect(publicAfter.body).toEqual(publicBefore.body);
    expect(publicJson).not.toContain('"draftId"');
    expect(publicJson).not.toContain('"name"');
    expect(publicJson).not.toContain('"objectKey"');
    expect(publicJson).not.toContain('"adminId"');
    expect(publicJson).not.toContain(invalidDraft.name);

    const stale = await request(app!.getHttpServer())
      .post(`/api/v1/admin/homepage/drafts/${invalidDraft.id}/publish`)
      .set(admin())
      .send({ version: invalidDraft.version + 1 })
      .expect(409);
    expect(stale.body).toMatchObject({
      code: ApiErrorCode.HOMEPAGE_VERSION_CONFLICT,
      details: { currentVersion: invalidDraft.version },
    });
    const missing = await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts/999999999999/publish')
      .set(admin())
      .send({ version: 1 })
      .expect(404);
    expect(missing.body.code).toBe(ApiErrorCode.HOMEPAGE_DRAFT_NOT_FOUND);
  });

  it('degrades product and category links invalidated after publication to NONE', async () => {
    const categoryRepository = dataSource.getRepository(Category);
    const productRepository = dataSource.getRepository(Product);
    const category = await categoryRepository.save(
      categoryRepository.create({ name: '发布后下架分类', isActive: true }),
    );
    const product = await productRepository.save(
      productRepository.create({
        name: '发布后下架商品',
        categoryId: category.id,
        detailHtml: '<p>homepage link target</p>',
        isActive: true,
      }),
    );
    const created = await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({ name: '链接降级方案', mode: 'BLANK' })
      .expect(201);
    const config = publishableConfig(
      (created.body as AdminHomepageView).draftConfig,
    );
    config.hero.slides[0]!.link = {
      type: HomepageLinkType.PRODUCT,
      targetId: product.id,
    };
    config.shortcutGrid.items[0]!.link = {
      type: HomepageLinkType.CATEGORY,
      targetId: category.id,
    };
    const saved = await request(app!.getHttpServer())
      .put(`/api/v1/admin/homepage/drafts/${created.body.id as string}`)
      .set(admin())
      .send({ config, version: created.body.version as number })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/admin/homepage/drafts/${saved.body.id as string}/publish`)
      .set(admin())
      .send({ version: saved.body.version as number })
      .expect(201);

    await Promise.all([
      productRepository.update(product.id, { isActive: false }),
      categoryRepository.update(category.id, { isActive: false }),
    ]);
    const publicView = await request(app!.getHttpServer())
      .get('/api/v1/public/homepage')
      .expect(200);

    expect(publicView.body.config.hero.slides[0].link).toEqual({
      type: HomepageLinkType.NONE,
    });
    expect(publicView.body.config.shortcutGrid.items[0].link).toEqual({
      type: HomepageLinkType.NONE,
    });
  });

  it('records publication audit source and fixed summaries without private data', async () => {
    const page = await dataSource
      .getRepository(HomepagePage)
      .findOneByOrFail({ pageKey: 'HOME' });
    const audit = await dataSource.getRepository(AuditLog).findOneOrFail({
      where: {
        targetEntity: 'homepage_pages',
        targetId: page.id,
        action: 'HOMEPAGE_PUBLISHED',
      },
      order: { id: 'DESC' },
    });
    const summary = JSON.stringify(audit.changeSummary);

    expect(audit.changeSummary).toMatchObject({
      sourceDraftId: page.publishedDraftId,
      sourceVersion: page.publishedDraftVersion,
      publishedVersion: page.publishedVersion,
      configHash: expect.any(String),
      sectionTypes: [
        HomepageSectionType.HERO_CAROUSEL,
        HomepageSectionType.CUSTOMER_SERVICE,
        HomepageSectionType.SHORTCUT_GRID,
        HomepageSectionType.IMAGE_BLOCK,
      ],
      heroSlideCount: expect.any(Number),
      shortcutCount: expect.any(Number),
      imageBlockCount: expect.any(Number),
    });
    expect(summary).not.toContain('draftConfig');
    expect(summary).not.toContain('name');
    expect(summary).not.toContain('phone');
    expect(summary).not.toContain('publicUrl');
    expect(summary).not.toContain('objectKey');
    expect(summary).not.toContain('http://');
  });

  it('forbids deleting the page published source but deletes an ordinary draft', async () => {
    const page = await dataSource
      .getRepository(HomepagePage)
      .findOneByOrFail({ pageKey: 'HOME' });
    const forbidden = await request(app!.getHttpServer())
      .delete(
        `/api/v1/admin/homepage/drafts/${page.publishedDraftId as string}`,
      )
      .set(admin())
      .expect(409);
    expect(forbidden.body.code).toBe(
      ApiErrorCode.HOMEPAGE_PUBLISHED_DRAFT_DELETE_FORBIDDEN,
    );

    await request(app!.getHttpServer())
      .delete(`/api/v1/admin/homepage/drafts/${blankDraft.id}`)
      .set(admin())
      .expect(204);
    await request(app!.getHttpServer())
      .get(`/api/v1/admin/homepage/drafts/${blankDraft.id}`)
      .set(admin())
      .expect(404);
  });

  it('records fixed section types without sensitive ids or arbitrary user text', async () => {
    const sensitiveName = 'secret-draft-name-13800000000';
    const renamedSensitiveName = 'https://private.example.test/draft-name';
    const created = await request(app!.getHttpServer())
      .post('/api/v1/admin/homepage/drafts')
      .set(admin())
      .send({ name: sensitiveName, mode: 'BLANK' })
      .expect(201);
    const sensitiveId = 'https://private.example.test/?phone=13800000000';
    const config = structuredClone(
      (created.body as AdminHomepageView).draftConfig,
    );
    config.hero.id = sensitiveId;

    const saved = await request(app!.getHttpServer())
      .put(`/api/v1/admin/homepage/drafts/${created.body.id as string}`)
      .set(admin())
      .send({ config, version: created.body.version as number })
      .expect(200);
    const renamed = await request(app!.getHttpServer())
      .patch(`/api/v1/admin/homepage/drafts/${created.body.id as string}`)
      .set(admin())
      .send({
        name: renamedSensitiveName,
        version: saved.body.version as number,
      })
      .expect(200);
    await request(app!.getHttpServer())
      .delete(`/api/v1/admin/homepage/drafts/${created.body.id as string}`)
      .set(admin())
      .expect(204);

    const audits = await dataSource.getRepository(AuditLog).find({
      where: {
        targetEntity: 'homepage_drafts',
        targetId: created.body.id as string,
      },
      order: { id: 'ASC' },
    });
    const summary = JSON.stringify(
      audits.map(({ changeSummary }) => changeSummary),
    );
    expect(summary).not.toContain(sensitiveId);
    expect(summary).not.toContain(sensitiveName);
    expect(summary).not.toContain(renamedSensitiveName);
    const savedAudit = audits.find(
      ({ action }) => action === 'HOMEPAGE_DRAFT_SAVED',
    );
    expect(savedAudit?.changeSummary).toMatchObject({
      changedSections: [HomepageSectionType.HERO_CAROUSEL],
    });
    expect(savedAudit?.changeSummary).not.toHaveProperty('changedSectionIds');
    expect(renamed.body.version).toBe((saved.body.version as number) + 1);
  });

  it('writes mutation audit summaries without full config, phone, or URL data', async () => {
    const logs = await dataSource.getRepository(AuditLog).find({
      where: { targetEntity: 'homepage_drafts' },
      order: { id: 'ASC' },
    });
    expect(logs.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'HOMEPAGE_DRAFT_CREATED',
        'HOMEPAGE_DRAFT_SAVED',
        'HOMEPAGE_DRAFT_RENAMED',
        'HOMEPAGE_DRAFT_DELETED',
      ]),
    );
    for (const log of logs) {
      const summary = JSON.stringify(log.changeSummary);
      expect(summary).not.toContain('draftConfig');
      expect(summary).not.toContain('phone');
      expect(summary).not.toContain('publicUrl');
      expect(summary).not.toContain('http://');
    }
  });
});
