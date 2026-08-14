import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'vant/lib/index.css';

import App from './App.vue';
import { installMiniappBridge, miniappMessageHub } from './bridge/miniapp.js';
import { router } from './router/index.js';

installMiniappBridge(miniappMessageHub.publish, {
  enableWindowMessages: import.meta.env.DEV,
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
