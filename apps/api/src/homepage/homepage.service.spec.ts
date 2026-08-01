import { describe, expect, it, vi } from 'vitest';

import {
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
    const service = new (HomepageService as unknown as HomepageServiceConstructor)(
      pages,
      drafts,
      {},
      {},
      {},
      { manager },
      { manager },
    );

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
});
