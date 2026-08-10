import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';

import App from './App.vue';
import { apiClient } from './api/http.js';
import { router } from './router/index.js';
import { useAdminAuthStore } from './stores/admin-auth.js';

/**
 * Merchant admin SPA bootstrap.
 *
 * Element Plus is registered globally so every view inherits the lilac/pink
 * theme tokens declared in `styles/theme.css`. The auth store is hydrated
 * right before the router mounts so the very first navigation's guard
 * already sees the persisted session.
 */
const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(ElementPlus);

const adminAuth = useAdminAuthStore(pinia);
adminAuth.hydrate();
apiClient.onUnauthorized(() => adminAuth.clearSession());

app.use(router);
app.mount('#app');
