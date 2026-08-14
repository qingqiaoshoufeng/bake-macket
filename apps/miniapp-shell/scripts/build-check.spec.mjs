import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { createMiniappConfigSources } from './config.mjs';

const execFileAsync = promisify(execFile);
const packageRootUrl = new URL('../', import.meta.url);
const repositoryRootUrl = new URL('../../../', import.meta.url);

/** @param {string[]} args */
async function runGit(args) {
  return execFileAsync('git', args, {
    cwd: fileURLToPath(repositoryRootUrl),
  });
}

test('derives H5 and API generated modules from one HTTPS URL', () => {
  const sources = createMiniappConfigSources(
    'https://MALL.example.com:443/?token=secret#credential=secret',
  );

  assert.equal(
    sources.h5,
    "export const MINIAPP_H5_URL = 'https://mall.example.com/?token=secret#credential=secret';\nexport const MINIAPP_H5_ORIGIN = 'https://mall.example.com';\n",
  );
  assert.equal(
    sources.api,
    "export const MINIAPP_API_BASE_URL = 'https://mall.example.com/api/v1';\n",
  );
  assert.doesNotMatch(sources.api, /token|credential|shop/);
});

test('keeps generated runtime configs ignored and declarations tracked', async () => {
  const ignored = await runGit([
    'check-ignore',
    'apps/miniapp-shell/config/h5.generated.js',
    'apps/miniapp-shell/config/api.generated.js',
  ]);
  assert.match(ignored.stdout, /h5\.generated\.js/);
  assert.match(ignored.stdout, /api\.generated\.js/);

  const status = await runGit([
    'status',
    '--short',
    '--untracked-files=all',
    '--',
    'apps/miniapp-shell/config/h5.generated.d.ts',
    'apps/miniapp-shell/config/api.generated.d.ts',
  ]);
  assert.doesNotMatch(status.stdout, /!!/);
  await access(new URL('config/h5.generated.d.ts', packageRootUrl));
  await access(new URL('config/api.generated.d.ts', packageRootUrl));
});

test('build generates both runtime modules and build-check validates them', async () => {
  const buildScript = fileURLToPath(
    new URL('scripts/build.mjs', packageRootUrl),
  );
  const checkScript = fileURLToPath(
    new URL('scripts/build-check.mjs', packageRootUrl),
  );
  const env = {
    ...process.env,
    MINIAPP_H5_URL: 'https://mall.example.com/?campaign=summer#checkout',
  };

  await execFileAsync(process.execPath, [buildScript], { env });
  await execFileAsync(process.execPath, [checkScript], { env });

  await access(new URL('config/api.generated.js', packageRootUrl));
  assert.equal(
    await readFile(new URL('config/api.generated.js', packageRootUrl), 'utf8'),
    "export const MINIAPP_API_BASE_URL = 'https://mall.example.com/api/v1';\n",
  );
});

test('build-check rejects runtime configs not generated from the current H5 source', async () => {
  const buildScript = fileURLToPath(
    new URL('scripts/build.mjs', packageRootUrl),
  );
  const checkScript = fileURLToPath(
    new URL('scripts/build-check.mjs', packageRootUrl),
  );
  const currentEnv = {
    ...process.env,
    MINIAPP_H5_URL: 'https://mall.example.com/?campaign=current#checkout',
  };
  const staleEnv = {
    ...process.env,
    MINIAPP_H5_URL: 'https://stale.example.com/',
  };

  await execFileAsync(process.execPath, [buildScript], { env: staleEnv });
  await assert.rejects(
    execFileAsync(process.execPath, [checkScript], { env: currentEnv }),
    /current MINIAPP_H5_URL/,
  );
});

test('build-check rejects an API runtime with a different or unsafe origin', async () => {
  const buildScript = fileURLToPath(
    new URL('scripts/build.mjs', packageRootUrl),
  );
  const checkScript = fileURLToPath(
    new URL('scripts/build-check.mjs', packageRootUrl),
  );
  const env = {
    ...process.env,
    MINIAPP_H5_URL: 'https://mall.example.com/',
  };
  const apiRuntimeUrl = new URL('config/api.generated.js', packageRootUrl);

  await execFileAsync(process.execPath, [buildScript], { env });
  for (const unsafeSource of [
    "export const MINIAPP_API_BASE_URL = 'https://attacker.example/api/v1';\n",
    "export const MINIAPP_API_BASE_URL = 'http://mall.example.com/api/v1';\n",
    "export const MINIAPP_API_BASE_URL = 'https://user@mall.example.com/api/v1';\n",
  ]) {
    await writeFile(apiRuntimeUrl, unsafeSource, 'utf8');
    await assert.rejects(
      execFileAsync(process.execPath, [checkScript], { env }),
      /generated API runtime/,
    );
  }
});

test('build-check requires exact generated runtime and declaration exports', async () => {
  const buildScript = fileURLToPath(
    new URL('scripts/build.mjs', packageRootUrl),
  );
  const checkScript = fileURLToPath(
    new URL('scripts/build-check.mjs', packageRootUrl),
  );
  const env = {
    ...process.env,
    MINIAPP_H5_URL: 'https://mall.example.com/',
  };
  const declarationUrl = new URL('config/api.generated.d.ts', packageRootUrl);
  const originalDeclaration = await readFile(declarationUrl, 'utf8');

  try {
    await execFileAsync(process.execPath, [buildScript], { env });
    await writeFile(
      new URL('config/api.generated.js', packageRootUrl),
      "const MINIAPP_API_BASE_URL = 'https://mall.example.com/api/v1';\nexport { MINIAPP_API_BASE_URL };\n",
      'utf8',
    );
    await assert.rejects(
      execFileAsync(process.execPath, [checkScript], { env }),
      /generated API runtime/,
    );

    await execFileAsync(process.execPath, [buildScript], { env });
    await writeFile(
      declarationUrl,
      `${originalDeclaration}export declare const ATTACKER_TOKEN: string;\n`,
      'utf8',
    );
    await assert.rejects(
      execFileAsync(process.execPath, [checkScript], { env }),
      /generated API declaration/,
    );
  } finally {
    await writeFile(declarationUrl, originalDeclaration, 'utf8');
  }
});
