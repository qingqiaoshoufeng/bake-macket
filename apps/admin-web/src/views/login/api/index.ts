import type { AuthSessionView } from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';
import type { AdminLoginFormValue } from '../type/index.js';

export const loginAsAdmin = (
  credentials: AdminLoginFormValue,
): Promise<AuthSessionView> =>
  apiClient.post<AuthSessionView>('/admin/auth/login', credentials);
