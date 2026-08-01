import type {
  AdminHomepageDraftListView,
  AdminHomepageView,
} from '@bake-mall/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../../../api/http.js';
import { homepageApi } from './index.js';

vi.mock('../../../api/http.js', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const client = vi.mocked(apiClient);

const response = {} as AdminHomepageView;
const listResponse = {} as AdminHomepageDraftListView;

describe('homepageApi', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('composes the draft collection and detail requests on the global client', async () => {
    client.get
      .mockResolvedValueOnce(listResponse)
      .mockResolvedValueOnce(response);
    client.post.mockResolvedValueOnce(response);
    client.put.mockResolvedValueOnce(response);
    client.patch.mockResolvedValueOnce(response);
    client.delete.mockResolvedValueOnce(undefined);

    const copy = {
      name: '七夕首页',
      mode: 'COPY' as const,
      sourceDraftId: '12',
    };
    const save = { config: response.draftConfig, version: 3 };
    const rename = { name: '中秋首页', version: 4 };
    const publish = { version: 5 };

    await homepageApi.list({ page: 2, pageSize: 20 });
    await homepageApi.create(copy);
    await homepageApi.getOne('12');
    await homepageApi.saveDraft('12', save);
    await homepageApi.rename('12', rename);
    await homepageApi.remove('12');
    await homepageApi.publish('12', publish);

    expect(client.get).toHaveBeenNthCalledWith(
      1,
      '/admin/homepage/drafts?page=2&pageSize=20',
    );
    expect(client.post).toHaveBeenNthCalledWith(
      1,
      '/admin/homepage/drafts',
      copy,
    );
    expect(client.get).toHaveBeenNthCalledWith(2, '/admin/homepage/drafts/12');
    expect(client.put).toHaveBeenCalledWith('/admin/homepage/drafts/12', save);
    expect(client.patch).toHaveBeenCalledWith(
      '/admin/homepage/drafts/12',
      rename,
    );
    expect(client.delete).toHaveBeenCalledWith('/admin/homepage/drafts/12');
    expect(client.post).toHaveBeenNthCalledWith(
      2,
      '/admin/homepage/drafts/12/publish',
      publish,
    );
  });
});
