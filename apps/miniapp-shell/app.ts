import type {
  AdminSessionView,
  CustomerAuthSessionView,
} from '@bake-mall/contracts';

import {
  createPhoneCredentialHandoffStore,
  createWechatLoginHandoffStore,
  type PhoneCredentialHandoffStore,
  type WechatLoginHandoffStore,
} from './utils/bridge.js';
import {
  createAdminSessionStore,
  createCustomerSessionStore,
  type MemorySessionStore,
} from './utils/admin-session.js';

export type BakeMallAppData = Readonly<{
  adminSession: MemorySessionStore<AdminSessionView>;
  customerSession: MemorySessionStore<CustomerAuthSessionView>;
  phoneCredentialHandoff: PhoneCredentialHandoffStore;
  wechatLoginHandoff: WechatLoginHandoffStore;
}>;

App<BakeMallAppData>({
  adminSession: createAdminSessionStore(),
  customerSession: createCustomerSessionStore(),
  phoneCredentialHandoff: createPhoneCredentialHandoffStore(),
  wechatLoginHandoff: createWechatLoginHandoffStore(),
});
