import uniModule from '@dcloudio/vite-plugin-uni';
import { defineConfig, type PluginOption } from 'vite';

const createUniPlugin = (
  uniModule as unknown as { default: () => PluginOption }
).default;

export default defineConfig({
  plugins: [createUniPlugin()],
});
