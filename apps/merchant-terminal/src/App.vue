<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';

import {
  buildDiagnosticSmokePageUrl,
  parseDiagnosticSmokeUrl,
} from './diagnostics/config/smoke-options.js';

let handledLaunchUrl: string | null = null;

onShow(() => {
  if (typeof plus === 'undefined') return;

  const launchUrl = plus.runtime.arguments;
  if (!launchUrl || launchUrl === handledLaunchUrl) return;

  const smokeOptions = parseDiagnosticSmokeUrl(launchUrl);
  if (!smokeOptions) return;

  handledLaunchUrl = launchUrl;
  void uni.reLaunch({ url: buildDiagnosticSmokePageUrl(smokeOptions) });
});
</script>

<style>
page {
  min-height: 100%;
  background: #fff8f2;
  color: #3d302b;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}
</style>
