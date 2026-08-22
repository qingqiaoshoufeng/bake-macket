import type {
  AdminSessionView,
  CustomerAuthSessionView,
} from '@bake-mall/contracts';

import {
  createPhoneCredentialHandoffStore,
  createProfileHandoffStore,
  createWechatLoginHandoffStore,
  type PhoneCredentialHandoffStore,
  type ProfileHandoffStore,
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
  profileHandoff: ProfileHandoffStore;
  wechatLoginHandoff: WechatLoginHandoffStore;
}>;

App<BakeMallAppData>({
  adminSession: createAdminSessionStore(),
  customerSession: createCustomerSessionStore(),
  phoneCredentialHandoff: createPhoneCredentialHandoffStore(),
  profileHandoff: createProfileHandoffStore(),
  wechatLoginHandoff: createWechatLoginHandoffStore(),
});
