import { authApi } from '../../../api/auth.js';
import { customerApi } from '../../../api/customer.js';

export const loginFeatureApi = {
  login: (phone: string, code: string) =>
    authApi.loginWithDevelopmentCode(phone, code),
  getProfile: (accessToken: string) => customerApi.getMe(accessToken),
};
