import type {
  WechatLoginRequest,
  WechatLoginResponse,
  WechatPhoneRequest,
  WechatPhoneResponse,
} from '@bake-mall/contracts';

import { authApi } from '../../../api/auth.js';
import { customerApi } from '../../../api/customer.js';
import { apiClient } from '../../../api/http.js';

export const loginFeatureApi = {
  login: (phone: string, code: string) =>
    authApi.loginWithDevelopmentCode(phone, code),
  getProfile: (accessToken: string) => customerApi.getMe(accessToken),
  loginWithWechatCode(code: string): Promise<WechatLoginResponse> {
    return apiClient.post<WechatLoginResponse>('/auth/wechat/login', {
      code,
    } satisfies WechatLoginRequest);
  },
  bindWechatPhone(code: string): Promise<WechatPhoneResponse> {
    return apiClient.post<WechatPhoneResponse>('/auth/wechat/phone', {
      code,
    } satisfies WechatPhoneRequest);
  },
};
