import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

import './generate-contracts-runtime.mjs';

import { createMiniappConfigSources, resolveBuildH5Url } from './config.mjs';

const configUrl = new URL('../config/', import.meta.url);
const h5Url = resolveBuildH5Url(process.env.MINIAPP_H5_URL);
const sources = createMiniappConfigSources(h5Url);

await mkdir(configUrl, { recursive: true });
await Promise.all([
  writeFile(fileURLToPath(new URL('h5.generated.js', configUrl)), sources.h5, {
    encoding: 'utf8',
    mode: 0o600,
  }),
  writeFile(
    fileURLToPath(new URL('api.generated.js', configUrl)),
    sources.api,
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  ),
]);
console.log('generated H5 and API configs from MINIAPP_H5_URL');
