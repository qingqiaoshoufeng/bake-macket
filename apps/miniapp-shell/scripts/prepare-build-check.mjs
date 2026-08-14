if (!process.env.MINIAPP_H5_URL?.trim()) {
  process.env.MINIAPP_H5_URL = 'https://miniapp-build-check.invalid/';
}

await import('./build.mjs');
