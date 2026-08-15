import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test, { after } from 'node:test';

import { createMiniappConfigSources } from './config.mjs';

const execFileAsync = promisify(execFile);
const packageRootUrl = new URL('../', import.meta.url);
const repositoryRootUrl = new URL('../../../', import.meta.url);
const h5RuntimeUrl = new URL('config/h5.generated.js', packageRootUrl);
const apiRuntimeUrl = new URL('config/api.generated.js', packageRootUrl);
const [originalH5Runtime, originalApiRuntime] = await Promise.all([
  readFile(h5RuntimeUrl, 'utf8'),
  readFile(apiRuntimeUrl, 'utf8'),
]);

after(async () => {
  await Promise.all([
    writeFile(h5RuntimeUrl, originalH5Runtime, 'utf8'),
    writeFile(apiRuntimeUrl, originalApiRuntime, 'utf8'),
  ]);
});

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
    'apps/miniapp-shell/config/contracts.generated.ts',
  ]);
  assert.match(ignored.stdout, /h5\.generated\.js/);
  assert.match(ignored.stdout, /api\.generated\.js/);
  assert.match(ignored.stdout, /contracts\.generated\.ts/);

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

test('registers both native credential pages and gates their official controls', async () => {
  const [appSource, phoneTemplate, loginTemplate] = await Promise.all([
    readFile(new URL('app.json', packageRootUrl), 'utf8'),
    readFile(new URL('pages/phone-auth/index.wxml', packageRootUrl), 'utf8'),
    readFile(new URL('pages/wechat-login/index.wxml', packageRootUrl), 'utf8'),
  ]);
  const app = JSON.parse(appSource);

  assert.ok(app.pages.includes('pages/phone-auth/index'));
  assert.ok(app.pages.includes('pages/wechat-login/index'));
  assert.match(phoneTemplate, /open-type="getPhoneNumber"/);
  assert.match(loginTemplate, /bindtap="onWechatLogin"/);
  assert.doesNotMatch(loginTemplate, /open-type="getPhoneNumber"/);
});

test('keeps the committed project config on the placeholder AppID', async () => {
  const project = JSON.parse(
    await readFile(new URL('project.config.json', packageRootUrl), 'utf8'),
  );
  assert.equal(project.appid, 'touristappid');
});

test('package build-check self-bootstraps safe generated config without an environment URL', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('package.json', packageRootUrl), 'utf8'),
  );
  const env = { ...process.env };
  delete env.MINIAPP_H5_URL;

  const prepareScript = fileURLToPath(
    new URL('scripts/prepare-build-check.mjs', packageRootUrl),
  );
  const checkScript = fileURLToPath(
    new URL('scripts/build-check.mjs', packageRootUrl),
  );
  await execFileAsync(process.execPath, [prepareScript], { env });
  await execFileAsync(process.execPath, [checkScript], { env });

  assert.match(packageJson.scripts['build:check'], /prepare-build-check/);
});

test('build generates local contracts runtime without bare workspace requires', async () => {
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

  await execFileAsync(process.execPath, [buildScript], { env });
  await execFileAsync(process.execPath, [checkScript], { env });

  const runtime = await readFile(
    new URL('config/contracts.generated.ts', packageRootUrl),
    'utf8',
  );
  assert.match(runtime, /export enum AdminPermission/);
  assert.match(runtime, /export enum PrintJobStatus/);
  assert.doesNotMatch(runtime, /@bake-mall\/contracts|require\s*\(/);
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

test('build-check rejects a committed real AppID', async () => {
  const checkScript = fileURLToPath(
    new URL('scripts/build-check.mjs', packageRootUrl),
  );
  const env = {
    ...process.env,
    MINIAPP_H5_URL: 'https://mall.example.com/',
  };
  const projectUrl = new URL('project.config.json', packageRootUrl);
  const originalProject = await readFile(projectUrl, 'utf8');

  try {
    await writeFile(
      projectUrl,
      originalProject.replace('touristappid', 'wx2cd800899cf6fab5'),
      'utf8',
    );
    await assert.rejects(
      execFileAsync(process.execPath, [checkScript], { env }),
      /placeholder AppID/,
    );
  } finally {
    await writeFile(projectUrl, originalProject, 'utf8');
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
