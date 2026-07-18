import type { AdminBannerView, SaveBannerRequest } from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

export const bannersApi = {
  list: (): Promise<AdminBannerView[]> => apiClient.get('/admin/banners'),
  create: (body: SaveBannerRequest): Promise<AdminBannerView> =>
    apiClient.post('/admin/banners', body),
  update: (id: string, body: SaveBannerRequest): Promise<AdminBannerView> =>
    apiClient.patch(`/admin/banners/${id}`, body),
  remove: (id: string): Promise<void> =>
    apiClient.delete(`/admin/banners/${id}`),
};
