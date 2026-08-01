import 'reflect-metadata';

import {
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
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JWT_ADMIN_AUDIENCE } from '../src/auth/auth.constants.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import { HomepageDraft } from '../src/database/entities/homepage-draft.entity.js';
import { HomepagePage } from '../src/database/entities/homepage-page.entity.js';
import * as entities from '../src/database/entities/index.js';
import { InitialSchema1718000000000 } from '../src/database/migrations/0001-initial-schema.js';
import { ProductSortOrder1718000000001 } from '../src/database/migrations/0002-product-sort-order.js';
import { Task12AdminMediaAndOrderIndexes1718000000002 } from '../src/database/migrations/0003-task12-admin-media-and-order-indexes.js';
import { SkuStockVersion1718000000003 } from '../src/database/migrations/0004-sku-stock-version.js';
import { MembershipAndOrderPricing1718000000004 } from '../src/database/migrations/0005-membership-and-order-pricing.js';
import { MembershipEntitlementSegments1718000000005 } from '../src/database/migrations/0006-membership-entitlement-segments.js';
import { DefaultMembershipLevels1718000000006 } from '../src/database/migrations/0007-default-membership-levels.js';
import { OrderItemSourceIds1718000000007 } from '../src/database/migrations/0008-order-item-source-ids.js';
import { HomepagePages1718000000008 } from '../src/database/migrations/0009-homepage-pages.js';
import { HomepageMultipleDrafts1718000000009 } from '../src/database/migrations/0010-homepage-multiple-drafts.js';
import { HomepageModule } from '../src/homepage/homepage.module.js';
import {
  createDockerRootSqlExecutor,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_homepage_drafts_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const ADMIN_SECRET = 'homepage-drafts-admin-secret-for-e2e';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };

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
          port: Number(process.env.TEST_MYSQL_PORT ?? 3306),
          database: DATABASE_NAME,
          username: APP_USER,
          password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
          charset: 'utf8mb4',
          timezone: 'Z',
          synchronize: false,
          entities: Object.values(entities),
          migrations: [
            InitialSchema1718000000000,
            ProductSortOrder1718000000001,
            Task12AdminMediaAndOrderIndexes1718000000002,
            SkuStockVersion1718000000003,
            MembershipAndOrderPricing1718000000004,
            MembershipEntitlementSegments1718000000005,
            DefaultMembershipLevels1718000000006,
            OrderItemSourceIds1718000000007,
            HomepagePages1718000000008,
            HomepageMultipleDrafts1718000000009,
          ],
          migrationsTableName: 'migrations',
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
        passwordHash: 'test-only',
        isActive: true,
      }),
    );
    adminId = adminUser.id;
    adminToken = await app.get(JwtService).signAsync(
      {
        sub: adminId,
        email: 'homepage-admin@example.test',
        aud: JWT_ADMIN_AUDIENCE,
      },
      { secret: ADMIN_SECRET },
    );
    initialDraft = (await dataSource.getRepository(HomepageDraft).findOneBy({
      name: '当前首页',
    })) as HomepageDraft;
  });

  afterAll(async () => {
    await app?.close();
    cleanupDatabase?.();
  });

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

  it('forbids deleting the page published source but deletes an ordinary draft', async () => {
    const forbidden = await request(app!.getHttpServer())
      .delete(`/api/v1/admin/homepage/drafts/${copiedDraft.id}`)
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
