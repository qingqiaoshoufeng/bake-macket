import type {
  AdminSessionView,
  AdminUserListQuery,
  AdminUserListResult,
  AdminUserView,
  ChangeAdminPasswordRequest,
  ChangeInitialOperatorPasswordRequest,
  CustomerAuthSessionView,
  WechatLoginRequest,
  WechatPhoneRequest,
} from '@bake-mall/contracts';

import type { BakeMallAppData } from '../../app.js';
import { createMiniappApiClient } from '../../utils/api-client.js';

export function createAdminApi(app: BakeMallAppData) {
  const client = createMiniappApiClient({
    adminSession: app.adminSession,
    customerSession: app.customerSession,
  });

  return {
    bindWechatPhone(code: string): Promise<CustomerAuthSessionView> {
      const body: WechatPhoneRequest = { code };
      return client.post('/auth/wechat/phone', body, { audience: 'customer' });
    },
    changeCurrent(body: ChangeAdminPasswordRequest): Promise<AdminSessionView> {
      return client.post('/admin/auth/password', body, { audience: 'admin' });
    },
    changeInitial(
      body: ChangeInitialOperatorPasswordRequest,
    ): Promise<AdminSessionView> {
      return client.post('/admin/auth/password/initial', body, {
        audience: 'admin',
      });
    },
    createUser(phone: string): Promise<AdminUserView> {
      return client.post('/admin/users', { phone }, { audience: 'admin' });
    },
    exchange(): Promise<AdminSessionView> {
      return client.post('/admin/auth/exchange', {}, { audience: 'customer' });
    },
    listUsers(query: AdminUserListQuery): Promise<AdminUserListResult> {
      return client.get('/admin/users', { audience: 'admin', query });
    },
    loginWithWechat(code: string): Promise<CustomerAuthSessionView> {
      const body: WechatLoginRequest = { code };
      return client.post('/auth/wechat/login', body);
    },
  } as const;
}
