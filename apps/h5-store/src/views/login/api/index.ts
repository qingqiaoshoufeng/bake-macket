import { authApi } from '../../../api/auth.js';

export const loginFeatureApi = {
  login: (phone: string, code: string) =>
    authApi.loginWithDevelopmentCode(phone, code),
};
