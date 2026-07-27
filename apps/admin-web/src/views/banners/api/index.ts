import type {
  AdminBannerListQuery,
  AdminBannerListResult,
  AdminBannerView,
  SaveBannerRequest,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

const toSearchParams = (query: AdminBannerListQuery): URLSearchParams =>
  new URLSearchParams(
    Object.entries(query)
      .filter((entry): entry is [string, string | number] => {
        const value = entry[1];
        return value !== undefined && value !== '';
      })
      .map(([key, value]) => [key, String(value)]),
  );

export const bannersApi = {
  list: (query: AdminBannerListQuery): Promise<AdminBannerListResult> =>
    apiClient.get(`/admin/banners?${toSearchParams(query).toString()}`),
  create: (body: SaveBannerRequest): Promise<AdminBannerView> =>
    apiClient.post('/admin/banners', body),
  update: (id: string, body: SaveBannerRequest): Promise<AdminBannerView> =>
    apiClient.patch(`/admin/banners/${id}`, body),
  remove: (id: string): Promise<void> =>
    apiClient.delete(`/admin/banners/${id}`),
};
