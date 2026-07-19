import type { AuthSessionView } from '@bake-mall/contracts';

import { apiClient } from './http.js';

export const authApi = {
  loginWithDevelopmentCode(phone: string, code: string): Promise<AuthSessionView> {
    return apiClient.post<AuthSessionView>('/auth/dev/login', { phone, code });
  },
};
