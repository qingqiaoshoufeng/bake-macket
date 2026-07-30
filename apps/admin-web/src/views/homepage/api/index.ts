import type {
  AdminHomepageView,
  PublishHomepageRequest,
  SaveHomepageDraftRequest,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

export const homepageApi = {
  get: (): Promise<AdminHomepageView> => apiClient.get('/admin/homepage'),
  saveDraft: (body: SaveHomepageDraftRequest): Promise<AdminHomepageView> =>
    apiClient.put('/admin/homepage/draft', body),
  publish: (body: PublishHomepageRequest): Promise<AdminHomepageView> =>
    apiClient.post('/admin/homepage/publish', body),
};
