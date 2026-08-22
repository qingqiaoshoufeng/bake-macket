import type {
  CustomerAuthSessionView,
  CustomerAvatarPresignRequest,
  CustomerAvatarPresignResponse,
  CustomerProfileView,
  UpdateCustomerProfileRequest,
  WechatLoginRequest,
} from '@bake-mall/contracts';

import type { BakeMallAppData } from '../../app.js';
import { createMiniappApiClient } from '../../utils/api-client.js';

export function createProfileCompletionApi(app: BakeMallAppData) {
  const client = createMiniappApiClient({
    adminSession: app.adminSession,
    customerSession: app.customerSession,
  });

  return {
    loginWithWechat(code: string): Promise<CustomerAuthSessionView> {
      const body: WechatLoginRequest = { code };
      return client.post('/auth/wechat/login', body);
    },
    presignAvatar(
      body: CustomerAvatarPresignRequest,
    ): Promise<CustomerAvatarPresignResponse> {
      return client.post('/me/profile/avatar/presign', body, {
        audience: 'customer',
      });
    },
    updateProfile(
      body: UpdateCustomerProfileRequest,
    ): Promise<CustomerProfileView> {
      return client.patch('/me/profile', body, { audience: 'customer' });
    },
    uploadAvatar(
      presign: CustomerAvatarPresignResponse,
      filePath: string,
    ): Promise<void> {
      return client.uploadPresignedPost({
        fields: presign.fields,
        filePath,
        uploadUrl: presign.uploadUrl,
      });
    },
  } as const;
}
