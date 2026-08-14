import 'reflect-metadata';

import {
  AdminRole,
  HomepageLinkType,
  HomepageSectionType,
  type HomepageDraftConfig,
} from '@bake-mall/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import { HomepageDraft } from '../src/database/entities/homepage-draft.entity.js';
import { HomepagePage } from '../src/database/entities/homepage-page.entity.js';
import * as entities from '../src/database/entities/index.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { HomepageService } from '../src/homepage/homepage.service.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_homepage_publish_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };

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

function dataSourceWithTransactionBarrier(source: DataSource): DataSource {
  const barrier = createBarrier(2);
  return new Proxy(source, {
    get(target, property, receiver) {
      if (property !== 'transaction')
        return Reflect.get(target, property, receiver);
      return <T>(operation: (manager: EntityManager) => Promise<T>) =>
        target.transaction(async (manager) => {
          await barrier.wait();
          return operation(manager);
        });
    },
  });
}

const toExpectedPublicConfig = (config: HomepageDraftConfig) => ({
  ...config,
  hero: {
    ...config.hero,
    slides: config.hero.slides.map((slide) => ({
      ...slide,
      image: { imageUrl: slide.image!.publicUrl },
    })),
  },
  customerService: {
    ...config.customerService,
    wechatQrCode: {
      imageUrl: config.customerService.wechatQrCode!.publicUrl,
    },
  },
  shortcutGrid: {
    ...config.shortcutGrid,
    items: config.shortcutGrid.items.map((item) => ({
      ...item,
      image: { imageUrl: item.image!.publicUrl },
    })),
  },
  imageBlocks: config.imageBlocks.map((block) => ({
    ...block,
    image: { imageUrl: block.image!.publicUrl },
  })),
});

const publishableConfig = (
  source: HomepageDraftConfig,
  marker: string,
): HomepageDraftConfig => ({
  ...structuredClone(source),
  hero: {
    ...structuredClone(source.hero),
    slides: [
      {
        id: `hero-${marker}`,
        image: {
          objectKey: `homepage/hero-${marker}.jpg`,
          publicUrl: `https://example.test/homepage/hero-${marker}.jpg`,
        },
        title: marker,
        subtitle: '',
        altText: '',
        link: { type: HomepageLinkType.NONE },
      },
    ],
  },
  customerService: {
    ...structuredClone(source.customerService),
    title: marker,
    phone: '13800000000',
    serviceHours: '09:00-18:00',
    wechatQrCode: {
      objectKey: `homepage/customer-${marker}.jpg`,
      publicUrl: `https://example.test/homepage/customer-${marker}.jpg`,
    },
  },
  shortcutGrid: {
    ...structuredClone(source.shortcutGrid),
    items: Array.from({ length: source.shortcutGrid.layout }, (_, index) => ({
      id: `shortcut-${marker}-${index + 1}`,
      label: `${marker}-${index + 1}`,
      image: {
        objectKey: `homepage/shortcut-${marker}-${index + 1}.jpg`,
        publicUrl: `https://example.test/homepage/shortcut-${marker}-${index + 1}.jpg`,
      },
      link: { type: HomepageLinkType.NONE },
    })),
  },
  imageBlocks: [
    {
      id: `image-${marker}`,
      type: HomepageSectionType.IMAGE_BLOCK,
      enabled: true,
      image: {
        objectKey: `homepage/image-${marker}.jpg`,
        publicUrl: `https://example.test/homepage/image-${marker}.jpg`,
      },
      title: marker,
      description: '',
      altText: '',
      link: { type: HomepageLinkType.NONE },
    },
  ],
});

describe.sequential('homepage draft publication concurrency (MySQL)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let database: DataSource | undefined;
  let adminId = '';

  const requireDatabase = (): DataSource => {
    if (!database)
      throw new Error('Temporary MySQL data source is unavailable');
    return database;
  };

  const createService = (): HomepageService => {
    const source = requireDatabase();
    return new HomepageService(
      source.getRepository(HomepagePage),
      source.getRepository(HomepageDraft),
      source.getRepository(entities.Product),
      source.getRepository(entities.Category),
      { assertHomepageAsset: () => undefined } as never,
      new AuditService(source.getRepository(AuditLog)),
      dataSourceWithTransactionBarrier(source),
    );
  };

  const createDrafts = async (
    markers: readonly string[],
  ): Promise<HomepageDraft[]> => {
    const source = requireDatabase();
    const page = await source
      .getRepository(HomepagePage)
      .findOneByOrFail({ pageKey: 'HOME' });
    const template = await source
      .getRepository(HomepageDraft)
      .findOneByOrFail({ homepagePageId: page.id });
    return source.getRepository(HomepageDraft).save(
      markers.map((marker) =>
        source.getRepository(HomepageDraft).create({
          homepagePageId: page.id,
          name: `并发发布 ${marker}-${randomUUID()}`,
          draftConfig: publishableConfig(template.draftConfig, marker),
          version: 3,
          updatedByAdminId: adminId,
        }),
      ),
    );
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
      const admin = await database.getRepository(AdminUser).save(
        database.getRepository(AdminUser).create({
          username: `homepage-publish-${randomUUID()}`,
          role: AdminRole.SUPER_ADMIN,
          linkedUserId: null,
          passwordHash: 'test-only',
          isActive: true,
          mustChangePassword: false,
          tokenVersion: 1,
        }),
      );
      adminId = admin.id;
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

  it('serializes concurrent publication of different drafts without mixing the final snapshot', async () => {
    const source = requireDatabase();
    const [draftA, draftB] = await createDrafts(['A', 'B']);
    if (!draftA || !draftB) throw new Error('Draft fixtures are unavailable');
    const before = await source
      .getRepository(HomepagePage)
      .findOneByOrFail({ pageKey: 'HOME' });
    const service = createService();

    const outcomes = await Promise.allSettled([
      service.publishDraftById(draftA.id, { version: draftA.version }, adminId),
      service.publishDraftById(draftB.id, { version: draftB.version }, adminId),
    ]);

    expect(outcomes).toEqual([
      expect.objectContaining({ status: 'fulfilled' }),
      expect.objectContaining({ status: 'fulfilled' }),
    ]);
    const publishedViews = outcomes
      .filter(
        (
          outcome,
        ): outcome is PromiseFulfilledResult<
          Awaited<ReturnType<HomepageService['publishDraftById']>>
        > => outcome.status === 'fulfilled',
      )
      .map(({ value }) => value);
    expect(publishedViews.map(({ id }) => id).sort()).toEqual(
      [draftA.id, draftB.id].sort(),
    );

    const page = await source
      .getRepository(HomepagePage)
      .findOneByOrFail({ pageKey: 'HOME' });
    const finalDraft = [draftA, draftB].find(
      ({ id }) => id === page.publishedDraftId,
    );
    if (!finalDraft)
      throw new Error('Published source is not a concurrent draft');
    const publicView = await service.getPublicView();

    expect(page.publishedVersion).toBe((before.publishedVersion ?? 0) + 2);
    expect(page.publishedDraftVersion).toBe(finalDraft.version);
    expect(page.publishedConfig).toEqual(finalDraft.draftConfig);
    expect(publicView).toEqual({
      publishedVersion: page.publishedVersion,
      publishedAt: page.publishedAt!.toISOString(),
      config: toExpectedPublicConfig(finalDraft.draftConfig),
    });
  });

  it('allows two concurrent publications of the same unchanged draft and advances the sequence twice', async () => {
    const source = requireDatabase();
    const [draft] = await createDrafts(['SAME']);
    if (!draft) throw new Error('Draft fixture is unavailable');
    const before = await source
      .getRepository(HomepagePage)
      .findOneByOrFail({ pageKey: 'HOME' });
    const service = createService();

    const outcomes = await Promise.allSettled([
      service.publishDraftById(draft.id, { version: draft.version }, adminId),
      service.publishDraftById(draft.id, { version: draft.version }, adminId),
    ]);

    expect(outcomes).toEqual([
      expect.objectContaining({ status: 'fulfilled' }),
      expect.objectContaining({ status: 'fulfilled' }),
    ]);
    const page = await source
      .getRepository(HomepagePage)
      .findOneByOrFail({ pageKey: 'HOME' });
    const persistedDraft = await source
      .getRepository(HomepageDraft)
      .findOneByOrFail({ id: draft.id });
    expect(page).toMatchObject({
      publishedDraftId: draft.id,
      publishedDraftVersion: draft.version,
      publishedConfig: draft.draftConfig,
      publishedVersion: (before.publishedVersion ?? 0) + 2,
    });
    expect(persistedDraft.version).toBe(draft.version);
  });
});
