import type {
  AdminSessionView,
  CustomerAuthSessionView,
} from '@bake-mall/contracts';

import {
  createPhoneCredentialHandoffStore,
  type PhoneCredentialHandoffStore,
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
}>;

App<BakeMallAppData>({
  adminSession: createAdminSessionStore(),
  customerSession: createCustomerSessionStore(),
  phoneCredentialHandoff: createPhoneCredentialHandoffStore(),
});
