import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';

import './generate-contracts-runtime.mjs';

import { createMiniappConfigSources, resolveBuildH5Url } from './config.mjs';
import { scanMiniappSourceBoundary } from './source-boundary.mjs';

const rootUrl = new URL('../', import.meta.url);

/** @param {string} relativePath */
async function read(relativePath) {
  return readFile(new URL(relativePath, rootUrl), 'utf8');
}

const [
  projectSource,
  appSource,
  indexTemplate,
  phoneTemplate,
  wechatLoginTemplate,
  h5Runtime,
  apiRuntime,
  h5Declaration,
  apiDeclaration,
  contractsRuntime,
] = await Promise.all([
  read('project.config.json'),
  read('app.json'),
  read('pages/index/index.wxml'),
  read('pages/phone-auth/index.wxml'),
  read('pages/wechat-login/index.wxml'),
  read('config/h5.generated.js'),
  read('config/api.generated.js'),
  read('config/h5.generated.d.ts'),
  read('config/api.generated.d.ts'),
  read('config/contracts.generated.ts'),
]);

const project = JSON.parse(projectSource);
const app = JSON.parse(appSource);
const generatedH5UrlMatch = h5Runtime.match(
  /^export const MINIAPP_H5_URL = '((?:\\[\\']|[^'\\])*)';\n/u,
);
const configuredH5Url = process.env.MINIAPP_H5_URL?.trim();
const generatedH5Url = generatedH5UrlMatch?.[1]?.replace(/\\([\\'])/gu, '$1');
const expectedSources = createMiniappConfigSources(
  resolveBuildH5Url(configuredH5Url || generatedH5Url),
);
const expectedH5Declaration =
  'export declare const MINIAPP_H5_URL: string;\n' +
  'export declare const MINIAPP_H5_ORIGIN: string;\n';
const expectedApiDeclaration =
  'export declare const MINIAPP_API_BASE_URL: string;\n';
/** @param {string} source */
const normalizeLineEndings = (source) => source.replace(/\r\n?/gu, '\n');

if (project.appid !== 'touristappid') {
  throw new Error(
    'committed project.config.json must keep the placeholder AppID; use project.private.config.json for real AppIDs',
  );
}
if (project.miniprogramRoot !== './') {
  throw new Error('project.config.json miniprogramRoot must be ./');
}
if (!project.setting?.useCompilerPlugins?.includes('typescript')) {
  throw new Error(
    'project.config.json setting must enable the typescript compiler plugin',
  );
}
if (!app.pages?.includes('pages/phone-auth/index')) {
  throw new Error('app.json must register pages/phone-auth/index');
}
if (!app.pages?.includes('pages/wechat-login/index')) {
  throw new Error('app.json must register pages/wechat-login/index');
}
if (indexTemplate.includes('bindmessage')) {
  throw new Error(
    'index web-view must not use bindmessage as a real-time channel',
  );
}
if (!indexTemplate.includes('bindload="onWebViewLoad"')) {
  throw new Error('index web-view must consume handoffs only after bindload');
}
if (
  !phoneTemplate.includes('open-type="getPhoneNumber"') ||
  !phoneTemplate.includes('bindgetphonenumber="onGetPhoneNumber"')
) {
  throw new Error('phone authorization page must use the official button flow');
}
if (
  !wechatLoginTemplate.includes('bindtap="onWechatLogin"') ||
  wechatLoginTemplate.includes('open-type="getPhoneNumber"')
) {
  throw new Error('WeChat login page must use an explicit login button');
}
if (expectedSources && h5Runtime !== expectedSources.h5) {
  throw new Error(
    'generated H5 runtime must match the current MINIAPP_H5_URL source',
  );
}
if (expectedSources && apiRuntime !== expectedSources.api) {
  throw new Error(
    'generated API runtime must match the current MINIAPP_H5_URL origin',
  );
}
if (normalizeLineEndings(h5Declaration) !== expectedH5Declaration) {
  throw new Error('generated H5 declaration must expose only URL and origin');
}
if (normalizeLineEndings(apiDeclaration) !== expectedApiDeclaration) {
  throw new Error(
    'generated API declaration must expose only MINIAPP_API_BASE_URL',
  );
}
if (
  !contractsRuntime.includes('export enum AdminPermission') ||
  !contractsRuntime.includes('export enum PrintJobStatus') ||
  contractsRuntime.includes('@bake-mall/contracts') ||
  /\brequire\s*\(/u.test(contractsRuntime)
) {
  throw new Error('generated contracts runtime is incomplete or non-local');
}

const sourceBoundaryDiagnostics = await scanMiniappSourceBoundary(
  fileURLToPath(rootUrl),
);
if (sourceBoundaryDiagnostics.length > 0) {
  throw new Error(
    sourceBoundaryDiagnostics
      .map(
        ({ filePath, line, column, message }) =>
          `${filePath}:${line}:${column} ${message}`,
      )
      .join('\n'),
  );
}

console.log('miniapp templates, generated configs and tooling are valid');
