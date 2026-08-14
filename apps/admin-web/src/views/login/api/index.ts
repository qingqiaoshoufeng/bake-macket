import type { AdminSessionView } from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';
import type { AdminLoginRequest } from '../type/index.js';

export const loginAsAdmin = (
  credentials: AdminLoginRequest,
): Promise<AdminSessionView> =>
  apiClient.post<AdminSessionView>('/admin/auth/login', credentials);
