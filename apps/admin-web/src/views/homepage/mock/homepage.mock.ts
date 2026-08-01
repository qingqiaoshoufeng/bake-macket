import {
  HomepageDraftStatus,
  type AdminHomepageDraftListView,
  type AdminHomepageView,
  type HomepageDraftConfig,
} from '@bake-mall/contracts';

import { createHomepageDraft } from '../config/defaults.js';

export const HOMEPAGE_PREVIEW_MOCK: HomepageDraftConfig = createHomepageDraft();

export const HOMEPAGE_DRAFT_DETAIL_MOCK: AdminHomepageView = {
  id: '1',
  pageKey: 'HOME',
  name: '当前首页',
  status: HomepageDraftStatus.PUBLISHED,
  draftConfig: HOMEPAGE_PREVIEW_MOCK,
  publishedConfig: null,
  version: 3,
  publishedVersion: 2,
  updatedAt: '2026-08-01T01:00:00.000Z',
  createdAt: '2026-07-31T00:00:00.000Z',
  publishedAt: '2026-08-01T00:30:00.000Z',
  draftIssues: [],
};

export const HOMEPAGE_DRAFT_LIST_MOCK: AdminHomepageDraftListView = {
  items: [
    {
      id: HOMEPAGE_DRAFT_DETAIL_MOCK.id,
      name: HOMEPAGE_DRAFT_DETAIL_MOCK.name ?? '当前首页',
      status:
        HOMEPAGE_DRAFT_DETAIL_MOCK.status ?? HomepageDraftStatus.PUBLISHED,
      version: HOMEPAGE_DRAFT_DETAIL_MOCK.version,
      updatedAt: HOMEPAGE_DRAFT_DETAIL_MOCK.updatedAt ?? '',
      createdAt: HOMEPAGE_DRAFT_DETAIL_MOCK.createdAt ?? '',
    },
    {
      id: '2',
      name: '七夕活动',
      status: HomepageDraftStatus.DRAFT,
      version: 1,
      updatedAt: '2026-08-01T02:00:00.000Z',
      createdAt: '2026-08-01T02:00:00.000Z',
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  publishedDraftId: HOMEPAGE_DRAFT_DETAIL_MOCK.id,
};
