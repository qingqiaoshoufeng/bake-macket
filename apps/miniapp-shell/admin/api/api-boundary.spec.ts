import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  analyzeMiniappSource,
  scanMiniappSourceBoundary,
} from '../../scripts/source-boundary.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const apiClientPath = fileURLToPath(
  new URL('../../utils/api-client.ts', import.meta.url),
);
const featureApiPath = fileURLToPath(
  new URL('../users/api/index.ts', import.meta.url),
);
const ordinarySourcePath = fileURLToPath(
  new URL('../../pages/index/index.ts', import.meta.url),
);

function diagnostics(filePath: string, source: string): readonly string[] {
  return analyzeMiniappSource({ filePath, packageRoot, source }).map(
    (diagnostic) => diagnostic.message,
  );
}

describe('miniapp request boundary AST scanner', () => {
  it('allows the canonical wx.request call in utils/api-client only', () => {
    expect(
      diagnostics(
        apiClientPath,
        'export function request(options: unknown) { return wx.request(options); }',
      ),
    ).toEqual([]);
  });

  it('rejects alternate WeChat network APIs even inside api-client', () => {
    expect(diagnostics(apiClientPath, 'wx.uploadFile(options);')).toContain(
      'utils/api-client.ts 只能调用 wx.request',
    );
  });

  it.each([
    ['direct member', 'wx.request(options);'],
    ['computed member', "wx['request'](options);"],
    ['template member', 'wx[`request`](options);'],
    ['method alias', 'const send = wx.request; send(options);'],
    [
      'computed method alias',
      "const method = 'request'; const send = wx[method]; send(options);",
    ],
    ['destructure', 'const { request } = wx; request(options);'],
    ['renamed destructure', 'const { request: send } = wx; send(options);'],
    ['wx alias', 'const sdk = wx; sdk.request(options);'],
    [
      'chained wx alias',
      'const sdk = wx; const next = sdk; const send = next.request; send(options);',
    ],
    ['network bypass', 'const { uploadFile: send } = wx; send(options);'],
  ])('rejects %s outside utils/api-client', (_name, source) => {
    expect(diagnostics(ordinarySourcePath, source)).toContain(
      '微信网络 API 只能由 utils/api-client.ts 调用',
    );
  });

  it.each([
    "// import { createMiniappApiClient } from '../../../utils/api-client.js';\nexport const list = () => [];",
    'const fake = "../../../utils/api-client.js";\nexport const list = () => fake;',
    "import { createMiniappApiClient } from '../../../utils/api-client.js';\nexport const list = () => [];",
    "import { createMiniappApiClient as makeClient } from '../../../utils/api-client.js';\nexport const list = () => createMiniappApiClient;",
    "import { createMiniappApiClient } from '../fake/utils/api-client.js';\nexport const client = createMiniappApiClient(dependencies);",
  ])('rejects admin feature API fake or unused imports', (source) => {
    expect(diagnostics(featureApiPath, source)).toContain(
      '原生管理 API 必须实际调用从 utils/api-client 导入的 createMiniappApiClient',
    );
  });

  it('accepts a real aliased api-client import binding call', () => {
    expect(
      diagnostics(
        featureApiPath,
        "import { createMiniappApiClient as makeClient } from '../../../utils/api-client.js';\nexport const client = makeClient(dependencies);",
      ),
    ).toEqual([]);
  });

  it('keeps the checked-in miniapp source tree inside the request boundary', async () => {
    await expect(scanMiniappSourceBoundary(packageRoot)).resolves.toEqual([]);
  });
});
