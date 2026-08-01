import type {
  AdminHomepageDraftListView,
  AdminHomepageView,
  AdminPageQuery,
  CreateHomepageDraftRequest,
  PublishHomepageRequest,
  RenameHomepageDraftRequest,
  SaveHomepageDraftRequest,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

const toSearchParams = (query: AdminPageQuery): URLSearchParams =>
  new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  );

export const homepageApi = {
  list: (query: AdminPageQuery): Promise<AdminHomepageDraftListView> =>
    apiClient.get(`/admin/homepage/drafts?${toSearchParams(query).toString()}`),
  create: (body: CreateHomepageDraftRequest): Promise<AdminHomepageView> =>
    apiClient.post('/admin/homepage/drafts', body),
  getOne: (id: string): Promise<AdminHomepageView> =>
    apiClient.get(`/admin/homepage/drafts/${id}`),
  saveDraft: (
    id: string,
    body: SaveHomepageDraftRequest,
  ): Promise<AdminHomepageView> =>
    apiClient.put(`/admin/homepage/drafts/${id}`, body),
  rename: (
    id: string,
    body: RenameHomepageDraftRequest,
  ): Promise<AdminHomepageView> =>
    apiClient.patch(`/admin/homepage/drafts/${id}`, body),
  remove: (id: string): Promise<void> =>
    apiClient.delete(`/admin/homepage/drafts/${id}`),
  publish: (
    id: string,
    body: PublishHomepageRequest,
  ): Promise<AdminHomepageView> =>
    apiClient.post(`/admin/homepage/drafts/${id}/publish`, body),
};
