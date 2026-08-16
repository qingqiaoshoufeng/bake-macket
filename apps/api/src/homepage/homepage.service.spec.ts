import { describe, expect, it, vi } from 'vitest';

import {
  HomepageLinkType,
  HomepageSectionType,
  type HomepageDraftConfig,
} from '@bake-mall/contracts';

import { HomepageService } from './homepage.service.js';

const draftConfig: HomepageDraftConfig = {
  schemaVersion: 1,
  hero: {
    id: 'hero',
    type: HomepageSectionType.HERO_CAROUSEL,
    enabled: true,
    autoplayMs: 5000,
    slides: [],
  },
  customerService: {
    id: 'customer-service',
    type: HomepageSectionType.CUSTOMER_SERVICE,
    enabled: true,
    title: '联系客服',
    description: '如需定制或帮助，欢迎联系我们',
    phone: '',
    serviceHours: '',
    wechatQrCode: null,
  },
  shortcutGrid: {
    id: 'shortcut-grid',
    type: HomepageSectionType.SHORTCUT_GRID,
    enabled: true,
    title: '快捷入口',
    layout: 4,
    items: [],
  },
  imageBlocks: [],
};

type HomepageServiceConstructor = new (
  pages: unknown,
  drafts: unknown,
  products: unknown,
  categories: unknown,
  mediaPolicy: unknown,
  audit: unknown,
  dataSource: unknown,
) => HomepageService;

const publishableDraftConfig: HomepageDraftConfig = {
  ...draftConfig,
  hero: {
    ...draftConfig.hero,
    slides: [
      {
        id: 'hero-slide-1',
        image: {
          objectKey: 'homepage/hero-slide-1.jpg',
          publicUrl: 'https://example.test/hero-slide-1.jpg',
        },
        title: '',
        subtitle: '',
        altText: '',
        link: { type: HomepageLinkType.NONE },
      },
    ],
  },
  customerService: {
    ...draftConfig.customerService,
    phone: '13800000000',
    serviceHours: '09:00-18:00',
    wechatQrCode: {
      objectKey: 'homepage/customer-service.jpg',
      publicUrl: 'https://example.test/customer-service.jpg',
    },
  },
  shortcutGrid: {
    ...draftConfig.shortcutGrid,
    items: Array.from({ length: 4 }, (_, index) => ({
      id: `shortcut-${index + 1}`,
      label: `入口 ${index + 1}`,
      image: {
        objectKey: `homepage/shortcut-${index + 1}.jpg`,
        publicUrl: `https://example.test/shortcut-${index + 1}.jpg`,
      },
      link: { type: HomepageLinkType.NONE },
    })),
  },
};

const createPublishService = (publishedVersion: number | null) => {
  const page = {
    id: 'page-1',
    pageKey: 'HOME' as const,
    publishedConfig: null,
    publishedVersion,
    publishedDraftId: null,
    publishedDraftVersion: null,
    publishedByAdminId: null,
    publishedAt: null,
  };
  const draft = {
    id: 'draft-1',
    homepagePageId: page.id,
    name: '当前首页',
    draftConfig: publishableDraftConfig,
    version: 4,
    updatedByAdminId: 'admin-1',
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  };
  const pageBuilder = {
    where: vi.fn().mockReturnThis(),
    setLock: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(page),
  };
  const draftBuilder = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    setLock: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(draft),
  };
  const pages = {
    createQueryBuilder: vi.fn(() => pageBuilder),
    save: vi.fn(async (savedPage) => savedPage),
  };
  const drafts = { createQueryBuilder: vi.fn(() => draftBuilder) };
  const manager = {
    getRepository: vi.fn((entity) => {
      if (entity.name === 'HomepagePage') return pages;
      if (entity.name === 'HomepageDraft') return drafts;
      throw new Error(`Unexpected repository: ${entity.name}`);
    }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new (
    HomepageService as unknown as HomepageServiceConstructor
  )({}, {}, {}, {}, { assertHomepageAsset: vi.fn() }, audit, {
    manager,
    transaction: (callback: (transactionManager: unknown) => unknown) =>
      callback(manager),
  });

  return { page, service };
};

describe('HomepageService 配置草稿原子创建', () => {
  it('在同一个事务中以完整配置创建草稿并记录审计，不需要后续保存事务', async () => {
    const page = {
      id: 'page-1',
      pageKey: 'HOME' as const,
      publishedConfig: null,
      publishedVersion: null,
      publishedDraftId: null,
      publishedDraftVersion: null,
      publishedByAdminId: null,
      publishedAt: null,
    };
    const savedDraft = {
      id: 'draft-configured',
      homepagePageId: page.id,
      name: '专业烘焙示例（开发）',
      draftConfig: publishableDraftConfig,
      version: 1,
      updatedByAdminId: 'admin-1',
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
    };
    const pages = {
      createQueryBuilder: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(page),
      })),
    };
    const drafts = {
      findOneBy: vi.fn().mockResolvedValue(null),
      create: vi.fn((draft) => draft),
      save: vi.fn().mockResolvedValue(savedDraft),
    };
    const manager = {
      getRepository: vi.fn((entity) => {
        if (entity.name === 'HomepagePage') return pages;
        if (entity.name === 'HomepageDraft') return drafts;
        throw new Error(`Unexpected repository: ${entity.name}`);
      }),
    };
    const transaction = vi.fn(
      (callback: (transactionManager: unknown) => unknown) => callback(manager),
    );
    const mediaPolicy = { assertHomepageAsset: vi.fn() };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new (
      HomepageService as unknown as HomepageServiceConstructor
    )({}, {}, {}, {}, mediaPolicy, audit, { manager, transaction });

    await expect(
      service.createDraftWithConfig(
        '专业烘焙示例（开发）',
        publishableDraftConfig,
        'admin-1',
      ),
    ).resolves.toMatchObject({
      id: 'draft-configured',
      draftConfig: publishableDraftConfig,
      version: 1,
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(drafts.findOneBy).toHaveBeenCalledWith({
      homepagePageId: page.id,
      name: '专业烘焙示例（开发）',
    });
    expect(drafts.create).toHaveBeenCalledWith({
      homepagePageId: page.id,
      name: '专业烘焙示例（开发）',
      draftConfig: publishableDraftConfig,
      version: 1,
      updatedByAdminId: 'admin-1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'draft-configured',
        action: 'HOMEPAGE_DRAFT_CREATED',
      }),
      manager,
    );
    expect(mediaPolicy.assertHomepageAsset).toHaveBeenCalledTimes(6);
  });
});

describe('HomepageService legacy singleton compatibility', () => {
  it('reads the migrated current HOME draft instead of removed homepage_pages draft columns', async () => {
    const pages = {
      createQueryBuilder: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
          id: 'page-1',
          pageKey: 'HOME',
          publishedConfig: null,
          publishedVersion: null,
          publishedByAdminId: null,
          publishedAt: null,
        }),
      })),
    };
    const drafts = {
      find: vi.fn().mockResolvedValue([
        {
          id: 'draft-older',
          homepagePageId: 'page-1',
          name: '备用草稿',
          draftConfig,
          version: 3,
          updatedByAdminId: null,
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          createdAt: new Date('2026-07-31T00:00:00.000Z'),
        },
        {
          id: 'draft-current',
          homepagePageId: 'page-1',
          name: '当前首页',
          draftConfig,
          version: 4,
          updatedByAdminId: 'admin-1',
          updatedAt: new Date('2026-08-01T01:00:00.000Z'),
          createdAt: new Date('2026-07-31T01:00:00.000Z'),
        },
      ]),
    };
    const manager = {};
    const service = new (
      HomepageService as unknown as HomepageServiceConstructor
    )(pages, drafts, {}, {}, {}, { manager }, { manager });

    const view = await service.getAdminView();

    expect(drafts.find).toHaveBeenCalledWith({
      where: { homepagePageId: 'page-1' },
      order: { id: 'ASC' },
    });
    expect(view).toMatchObject({
      id: 'page-1',
      draftConfig,
      version: 4,
      draftUpdatedByAdminId: 'admin-1',
      draftUpdatedAt: '2026-08-01T01:00:00.000Z',
    });
  });

  it('starts the page publication sequence at one for its first publish', async () => {
    const { page, service } = createPublishService(null);

    await service.publish({ version: 4 }, 'admin-1');

    expect(page).toMatchObject({
      publishedVersion: 1,
      publishedDraftVersion: 4,
    });
  });

  it('increments the page publication sequence when publishing the same unchanged draft again', async () => {
    const { page, service } = createPublishService(8);

    await service.publish({ version: 4 }, 'admin-1');
    await service.publish({ version: 4 }, 'admin-1');

    expect(page).toMatchObject({
      publishedVersion: 10,
      publishedDraftVersion: 4,
    });
  });
});
