import type { AdminSessionView } from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';
import type {
  CurrentAdminPasswordRequest,
  InitialAdminPasswordRequest,
} from '../type/index.js';

export const changeInitialAdminPassword = (
  request: InitialAdminPasswordRequest,
): Promise<AdminSessionView> =>
  apiClient.post<AdminSessionView>('/admin/auth/password/initial', request);

export const changeAdminPassword = (
  request: CurrentAdminPasswordRequest,
): Promise<AdminSessionView> =>
  apiClient.post<AdminSessionView>('/admin/auth/password', request);
