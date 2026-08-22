import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'vant/lib/index.css';

import App from './App.vue';
import { apiClient } from './api/http.js';
import {
  installMiniappBridge,
  miniappMessageHub,
  requestMiniappWechatLogin,
} from './bridge/miniapp.js';
import { createStoreRouter } from './router/index.js';
import { useAuthStore } from './stores/auth.js';
import { useProfileRefreshStore } from './stores/profile-refresh.js';
import {
  createWechatAuthCoordinator,
  loginFeatureApi,
} from './views/login/index.js';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

const auth = useAuthStore(pinia);
const profileRefresh = useProfileRefreshStore(pinia);
auth.hydrate();

function clearSession(): void {
  auth.clearSession();
}

apiClient.onUnauthorized(clearSession);

const wechatAuth = createWechatAuthCoordinator({
  applySession: auth.applyCustomerSession,
  exchangeWechatCode: loginFeatureApi.loginWithWechatCode,
  hub: miniappMessageHub,
});
wechatAuth.start();
let receivedStartupWechatCode = false;
function publishMiniappMessage(
  message: Parameters<typeof miniappMessageHub.publish>[0],
): void {
  if (message.type === 'WECHAT_CODE') receivedStartupWechatCode = true;
  if (message.type === 'PROFILE_UPDATED') void profileRefresh.refresh();
  miniappMessageHub.publish(message);
}
installMiniappBridge(publishMiniappMessage, {
  enableWindowMessages: import.meta.env.DEV,
});
if (!auth.isAuthenticated && !receivedStartupWechatCode) {
  void requestMiniappWechatLogin(undefined, { automatic: true });
}

const router = createStoreRouter({
  waitForCurrentAttempt: wechatAuth.waitForCurrentAttempt,
});
app.use(router);
app.mount('#app');
