import { describe, expect, it } from 'vitest';

import {
  ApiErrorCode,
  HomepageDraftStatus,
  HomepageSectionType,
  type AdminHomepageDraftListView,
  type AdminHomepageView,
} from './index.js';

describe('homepage draft contracts', () => {
  it('exposes the defined draft statuses', () => {
    expect(HomepageDraftStatus).toEqual({
      PUBLISHED: 'PUBLISHED',
      PUBLISHED_WITH_CHANGES: 'PUBLISHED_WITH_CHANGES',
      DRAFT: 'DRAFT',
    });
  });

  it('models paginated draft summaries with the published source', () => {
    const view: AdminHomepageDraftListView = {
      items: [
        {
          id: 'draft-1',
          name: '当前首页',
          status: HomepageDraftStatus.PUBLISHED,
          version: 3,
          updatedByAdminId: 'admin-1',
          updatedAt: '2026-08-01T00:00:00.000Z',
          createdAt: '2026-07-31T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      publishedDraftId: 'draft-1',
    };

    expect(view.items[0]?.status).toBe(HomepageDraftStatus.PUBLISHED);
    expect(view.publishedDraftId).toBe('draft-1');
  });

  it('retains the legacy published config alongside draft fields', () => {
    const view: AdminHomepageView = {
      id: 'homepage-1',
      pageKey: 'HOME',
      draftConfig: {
        schemaVersion: 1,
        hero: {
          id: 'hero',
          type: HomepageSectionType.HERO_CAROUSEL,
          enabled: true,
          autoplayMs: 3000,
          slides: [],
        },
        customerService: {
          id: 'customer-service',
          type: HomepageSectionType.CUSTOMER_SERVICE,
          enabled: true,
          title: '',
          description: '',
          phone: '',
          serviceHours: '',
          wechatQrCode: null,
        },
        shortcutGrid: {
          id: 'shortcut-grid',
          type: HomepageSectionType.SHORTCUT_GRID,
          enabled: true,
          title: '',
          layout: 3,
          items: [],
        },
        imageBlocks: [],
      },
      version: 1,
      draftIssues: [],
      publishedConfig: null,
    };

    expect(view.publishedConfig).toBeNull();
    expect(view.draftConfig.schemaVersion).toBe(1);
  });

  it('exposes dedicated homepage draft error codes', () => {
    expect(ApiErrorCode.HOMEPAGE_DRAFT_NOT_FOUND).toBe(
      'HOMEPAGE_DRAFT_NOT_FOUND',
    );
    expect(ApiErrorCode.HOMEPAGE_DRAFT_NAME_CONFLICT).toBe(
      'HOMEPAGE_DRAFT_NAME_CONFLICT',
    );
    expect(ApiErrorCode.HOMEPAGE_PUBLISHED_DRAFT_DELETE_FORBIDDEN).toBe(
      'HOMEPAGE_PUBLISHED_DRAFT_DELETE_FORBIDDEN',
    );
  });
});
