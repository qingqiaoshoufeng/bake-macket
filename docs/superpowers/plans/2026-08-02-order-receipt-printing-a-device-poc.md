# 订单小票打印 A：设备 PoC Implementation Plan

> **面向执行代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务实施。所有步骤使用复选框跟踪。

**目标：** 建立可安装的 uni-app Android 最小应用，通过 fake TCP 与真实芯烨 XP-58IIH 验证原始 TCP、中文编码、58mm 列宽、换行、走纸和切刀能力，并输出后续终端唯一允许使用的 capability fixture。

**架构：** Node/Vitest 层实现可测试的纯排版和 fake printer；UTS Android 插件只负责字符编码、TCP 连接和完整字节写入；诊断页按固定步骤驱动真实设备。普通 workspace 检查不依赖 Android SDK，Android 构建和 adb 验证使用独立命令。

**技术栈：** pnpm workspace、Vue 3、uni-app、UTS、Android `java.net.Socket`、Vitest、Node `net` fake server、ESC/POS、GB18030/GBK。

**权威规格：** `docs/superpowers/specs/2026-08-02-order-receipt-printing-design.md`

---

## 文件结构

```text
apps/merchant-terminal/
├─ package.json                         host-safe 脚本
├─ manifest.json / pages.json           Android 应用与页面
├─ pages/diagnostics/                    真机诊断 UI
├─ src/capabilities/                     能力 schema 与实测 fixture
├─ src/receipt/                          显示宽度、排版和 PoC 文档
├─ src/diagnostics/                      固定诊断流程
├─ scripts/fake-printer-server.mjs       可注入故障的 TCP 打印机
├─ scripts/verify-android.mjs            独立 Android gate
└─ uni_modules/bake-escpos-printer/      UTS TCP/编码插件
```

## 阶段门

- 本计划不得接入真实订单或设备鉴权。
- Task 6 未用真实 XP-58IIH 完成前，不得开始计划 B/C。
- fixture 不得包含门店 IP、Wi-Fi、打印机序列号或个人信息。

### Task 1：建立 host-safe 的 uni-app workspace

**文件：**

- 创建：`apps/merchant-terminal/package.json`
- 创建：`apps/merchant-terminal/tsconfig.json`
- 创建：`apps/merchant-terminal/vitest.config.ts`
- 创建：`apps/merchant-terminal/vite.config.ts`
- 创建：`apps/merchant-terminal/eslint.config.mjs`
- 创建：`apps/merchant-terminal/scripts/package-android.mjs`
- 创建：`apps/merchant-terminal/manifest.json`
- 创建：`apps/merchant-terminal/pages.json`
- 创建：`apps/merchant-terminal/main.ts`
- 创建：`apps/merchant-terminal/App.vue`
- 创建：`apps/merchant-terminal/src/config/workspace.spec.ts`
- 修改：`scripts/verify-workspace.mjs`
- 修改：`pnpm-lock.yaml`

- [ ] **Step 1：先写 workspace 失败测试**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { name: string; scripts: Record<string, string> };

describe('merchant terminal workspace', () => {
  it('keeps Android tooling out of the normal build gate', () => {
    expect(packageJson.name).toBe('@bake-mall/merchant-terminal');
    expect(packageJson.scripts.build).toBe('pnpm build:check');
    expect(packageJson.scripts['build:app-resources']).toBe(
      'uni build -p app-android',
    );
    expect(packageJson.scripts['package:android']).toBe(
      'node scripts/package-android.mjs',
    );
    expect(packageJson.scripts.build).not.toContain('app');
  });
});
```

- [ ] **Step 2：运行并确认 RED**

Run：

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/config/workspace.spec.ts
```

Expected：FAIL，workspace 尚不存在或缺少脚本。

- [ ] **Step 3：创建最小 package 和应用入口**

`package.json` 脚本固定为：

```json
{
  "name": "@bake-mall/merchant-terminal",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm build:check",
    "build:check": "vue-tsc -p tsconfig.json --noEmit",
    "build:app-resources": "uni build -p app-android",
    "package:android": "node scripts/package-android.mjs",
    "test": "vitest run",
    "typecheck": "vue-tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "verify:android": "node scripts/verify-android.mjs"
  },
  "dependencies": {
    "@dcloudio/uni-app": "3.0.0-alpha-5020320260731001",
    "@dcloudio/uni-app-plus": "3.0.0-alpha-5020320260731001",
    "@dcloudio/uni-components": "3.0.0-alpha-5020320260731001",
    "vue": "3.4.21"
  },
  "devDependencies": {
    "@dcloudio/types": "3.4.31",
    "@dcloudio/uni-cli-shared": "3.0.0-alpha-5020320260731001",
    "@dcloudio/vite-plugin-uni": "3.0.0-alpha-5020320260731001",
    "@types/node": "^22.13.0",
    "@vue/tsconfig": "^0.7.0",
    "typescript": "^5.8.2",
    "vite": "5.2.8",
    "vitest": "^3.2.4",
    "vue-tsc": "^2.1.10"
  }
}
```

所有 `@dcloudio/*` 包必须锁在同一 Vue 3 发布线，`vite` 必须满足该插件精确 peer 版本，不能直接复用其他 SPA 的 Vite 5.4。Vitest、TypeScript 和 vue-tsc 在该 workspace 显式声明，不能依赖其他 app 偶然安装。`vite.config.ts` 使用 `@dcloudio/vite-plugin-uni`；`eslint.config.mjs` 只重新导出根 flat config，复用根 ESLint 工具链。应用包名固定为 `com.bakemall.merchantterminal`；`pages.json` 首期只注册诊断页。

`build:app-resources` 只生成 `dist/build/app-android` 等 App 打包资源，不声称生成 APK/AAB。`package:android` 包装 HBuilderX CLI `pack --config <受忽略的签名配置>`：脚本必须先校验 HBuilderX CLI 版本、登录状态、资源目录和签名配置，签名密码不得进入仓库。`verify:android` 只消费已生成的调试 APK，通过 adb 安装和验证。`scripts/verify-workspace.mjs` 检查 package 和入口存在，但普通根 `build` 不执行资源编译、HBuilderX 打包或 adb。

- [ ] **Step 4：运行 host-safe 门禁**

```bash
pnpm install
pnpm verify:workspace
pnpm --filter @bake-mall/merchant-terminal test
pnpm --filter @bake-mall/merchant-terminal typecheck
pnpm --filter @bake-mall/merchant-terminal build
```

Expected：全部 PASS；机器无 Android SDK 时也能通过。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal scripts/verify-workspace.mjs pnpm-lock.yaml
git commit -m "chore(terminal): scaffold android merchant terminal workspace"
```

### Task 2：定义实测 capability 契约

**文件：**

- 创建：`apps/merchant-terminal/src/capabilities/poc-capability.ts`
- 创建：`apps/merchant-terminal/src/capabilities/poc-capability.spec.ts`
- 创建：`apps/merchant-terminal/src/capabilities/fake-capability.fixture.ts`

- [ ] **Step 1：先写能力校验失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { parseVerifiedCapability } from './poc-capability.js';

describe('parseVerifiedCapability', () => {
  it('rejects unverified or unsafe printer capability data', () => {
    expect(() =>
      parseVerifiedCapability({
        model: 'XINYE_XP_58IIH',
        transport: 'RAW_TCP',
        tcpPort: 0,
        encoding: 'GB18030',
        charactersPerLine: 0,
        asciiWidth: 1,
        cjkWidth: 2,
        feedLines: 3,
        supportsCut: true,
        cutCommandHex: null,
        connectionTimeoutMs: 3000,
        writeTimeoutMs: 5000,
        selfTestReference: 'redacted',
        verifiedAt: '2026-08-02T00:00:00.000Z',
        verificationStatus: 'FAILED',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/capabilities/poc-capability.spec.ts
```

Expected：FAIL，parser 尚不存在。

- [ ] **Step 3：实现严格类型和 parser**

```ts
export type PocPrinterCapability = Readonly<{
  model: 'XINYE_XP_58IIH';
  transport: 'RAW_TCP';
  tcpPort: number;
  encoding: 'GB18030' | 'GBK';
  charactersPerLine: number;
  asciiWidth: 1;
  cjkWidth: 2;
  feedLines: number;
  supportsCut: boolean;
  cutCommandHex: string | null;
  connectionTimeoutMs: number;
  writeTimeoutMs: number;
  selfTestReference: string;
  verifiedAt: string;
  verificationStatus: 'PASSED';
}>;

export function parseVerifiedCapability(value: unknown): PocPrinterCapability {
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid capability');
  const candidate = value as Partial<PocPrinterCapability>;
  if (
    candidate.model !== 'XINYE_XP_58IIH' ||
    candidate.transport !== 'RAW_TCP' ||
    candidate.verificationStatus !== 'PASSED' ||
    !Number.isInteger(candidate.tcpPort) ||
    (candidate.tcpPort ?? 0) < 1 ||
    !Number.isInteger(candidate.charactersPerLine) ||
    (candidate.charactersPerLine ?? 0) < 1 ||
    (candidate.supportsCut === true && !candidate.cutCommandHex)
  ) {
    throw new Error('Unverified printer capability');
  }
  return candidate as PocPrinterCapability;
}
```

扩展测试覆盖非法 encoding、端口范围、列数、超时、日期和未验证切刀。

- [ ] **Step 4：运行测试**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/capabilities/poc-capability.spec.ts
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/src/capabilities
git commit -m "test(terminal): define printer capability fixture contract"
```

### Task 3：实现显示宽度和 PoC 票据排版

**文件：**

- 创建：`apps/merchant-terminal/src/receipt/display-width.ts`
- 创建：`apps/merchant-terminal/src/receipt/text-layout.ts`
- 创建：`apps/merchant-terminal/src/receipt/poc-receipt.ts`
- 创建：`apps/merchant-terminal/src/receipt/poc-receipt.spec.ts`

- [ ] **Step 1：先写宽度、换行和控制字符测试**

```ts
import { describe, expect, it } from 'vitest';
import { displayWidth, sanitizePrintableText } from './display-width.js';
import { wrapByDisplayWidth } from './text-layout.js';

describe('58mm text layout', () => {
  it('uses display cells instead of string length', () => {
    expect(displayWidth('AB草莓')).toBe(6);
    expect(wrapByDisplayWidth('草莓奶油蛋糕ABC', 8)).toEqual([
      '草莓奶油',
      '蛋糕ABC',
    ]);
    expect(sanitizePrintableText(`备注${String.fromCharCode(27)}@安全`)).toBe(
      '备注@安全',
    );
  });
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/receipt/poc-receipt.spec.ts
```

Expected：FAIL，函数尚不存在。

- [ ] **Step 3：实现纯函数**

```ts
const CONTROL_CHARACTER = new RegExp(
  '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]',
  'gu',
);

-]/gu;

export const sanitizePrintableText = (text: string): string =>
  text.normalize('NFC').replace(CONTROL_CHARACTER, '');

export const displayWidth = (text: string): number =>
  [...sanitizePrintableText(text)].reduce(
    (width, character) => width + (/^[\x00-\x7f]$/u.test(character) ? 1 : 2),
    0,
  );
```

`wrapByDisplayWidth` 使用不可变 `reduce` 返回新数组；`buildPocReceipt()` 生成英文、中文、金额右对齐、长商品名、备注、地址、走纸和可选切刀探针，不在 helper 内修改入参。

- [ ] **Step 4：运行定向测试和 typecheck**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/receipt/poc-receipt.spec.ts
pnpm --filter @bake-mall/merchant-terminal typecheck
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/src/receipt
git commit -m "feat(terminal): add immutable 58mm receipt layout probe"
```

### Task 4：实现 fake TCP printer 和 UTS adapter

**文件：**

- 创建：`apps/merchant-terminal/scripts/fake-printer-server.mjs`
- 创建：`apps/merchant-terminal/scripts/fake-printer-server.test.mjs`
- 创建：`apps/merchant-terminal/uni_modules/bake-escpos-printer/package.json`
- 创建：`apps/merchant-terminal/uni_modules/bake-escpos-printer/interface.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-escpos-printer/utssdk/app-android/index.uts`

- [ ] **Step 1：写 fake server 失败模式测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { startFakePrinter } from './fake-printer-server.mjs';

test('captures all bytes and supports mid-write disconnect', async () => {
  const complete = await startFakePrinter({ mode: 'COMPLETE' });
  const broken = await startFakePrinter({ mode: 'DROP_AFTER_BYTES', bytes: 4 });
  assert.equal(complete.mode, 'COMPLETE');
  assert.equal(broken.dropAfterBytes, 4);
  await Promise.all([complete.close(), broken.close()]);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
node --test apps/merchant-terminal/scripts/fake-printer-server.test.mjs
```

Expected：FAIL，fake server 尚不存在。

- [ ] **Step 3：实现 fake server 与 UTS 接口**

UTS 公共接口固定为：

```ts
export type PrinterConnection = {
  write(bytes: ByteArray): Promise<number>;
  close(): Promise<void>;
};

export function connectPrinter(
  host: string,
  port: number,
  connectTimeoutMs: number,
  writeTimeoutMs: number,
): Promise<PrinterConnection>;

export function encodePrinterText(
  text: string,
  encoding: 'GB18030' | 'GBK',
): ByteArray;
```

Android 实现使用 IO dispatcher/thread；`write` 循环直至完整写入或抛出包含已写字节数的结构化异常。fake server 支持 `COMPLETE`、`DROP_ON_CONNECT`、`DROP_AFTER_BYTES`，并返回接收字节 SHA-256。

- [ ] **Step 4：验证 Node、App 资源和 Android 包装 gate**

```bash
node --test apps/merchant-terminal/scripts/fake-printer-server.test.mjs
pnpm --filter @bake-mall/merchant-terminal build:app-resources
pnpm --filter @bake-mall/merchant-terminal package:android
```

Expected：fake server PASS；uni CLI 生成 App Android 资源；安装并登录 HBuilderX CLI、提供受忽略签名配置后生成调试 APK。资源构建通过本身不得报告 APK 已生成。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/scripts apps/merchant-terminal/uni_modules
git commit -m "feat(terminal): add uts raw tcp printer adapter"
```

### Task 5：建立诊断页和 Android smoke

**文件：**

- 创建：`apps/merchant-terminal/pages/diagnostics/DiagnosticsPage.vue`
- 创建：`apps/merchant-terminal/src/diagnostics/components/DiagnosticResultList.vue`
- 创建：`apps/merchant-terminal/src/diagnostics/hooks/usePrinterDiagnostic.ts`
- 创建：`apps/merchant-terminal/src/diagnostics/hooks/usePrinterDiagnostic.spec.ts`
- 创建：`apps/merchant-terminal/src/diagnostics/config/diagnostic-steps.ts`
- 创建：`apps/merchant-terminal/src/diagnostics/type/index.ts`
- 创建：`apps/merchant-terminal/src/diagnostics/api/index.ts`
- 创建：`apps/merchant-terminal/src/diagnostics/mock/diagnostic.mock.ts`
- 创建：`apps/merchant-terminal/scripts/verify-android.mjs`

- [ ] **Step 1：写固定步骤与切刀门禁测试**

```ts
it('requires all receipt checks before optional cut testing', async () => {
  const result = await runPrinterDiagnostics(input, adapter);
  expect(result.map(({ step }) => step)).toEqual([
    'TCP_CONNECT',
    'ASCII',
    'CHINESE',
    'ALIGNMENT',
    'LONG_TEXT',
    'FEED',
    'CUT',
  ]);
  expect(result.at(-1)).toMatchObject({ step: 'CUT', outcome: 'SKIPPED' });
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/diagnostics/hooks/usePrinterDiagnostic.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现 hook 和页面**

```ts
export type DiagnosticStepResult = Readonly<{
  step:
    | 'TCP_CONNECT'
    | 'ASCII'
    | 'CHINESE'
    | 'ALIGNMENT'
    | 'LONG_TEXT'
    | 'FEED'
    | 'CUT';
  outcome: 'PASSED' | 'FAILED' | 'SKIPPED';
  detail: string;
}>;
```

组件只展示和发出事件；连接、步骤 orchestration 和 immutable 状态更新在 hook；mock、config、type、api 职责目录全部存在。切刀默认跳过，必须人工勾选且前置步骤均通过。

- [ ] **Step 4：实现并运行 Android smoke**

`verify-android.mjs` 先验证 adb 可用且 `package:android` 已生成调试 APK，再启动 fake printer，使用 emulator host `10.0.2.2`，安装 APK、通过 adb deep link 打开诊断页，并比较日志中的 bytes hash。脚本不得自行假装把 uni App 资源当 APK 安装。

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/diagnostics
pnpm --filter @bake-mall/merchant-terminal build:app-resources
pnpm --filter @bake-mall/merchant-terminal package:android
pnpm --filter @bake-mall/merchant-terminal verify:android
```

Expected：Node test PASS；emulator 完整接收 PASS，中途断开被识别为失败。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/pages apps/merchant-terminal/src/diagnostics apps/merchant-terminal/scripts/verify-android.mjs
git commit -m "feat(terminal): add printer diagnostic poc workflow"
```

### Task 6：完成 XP-58IIH 真机矩阵和阶段门

**文件：**

- 创建：`apps/merchant-terminal/src/capabilities/xinye-xp58iih.verified.json`
- 创建：`apps/merchant-terminal/src/capabilities/xinye-xp58iih.verified.spec.ts`
- 创建：`docs/runbook/xinye-xp58iih-poc.md`

- [ ] **Step 1：写拒绝猜测值的 fixture 测试**

```ts
import capability from './xinye-xp58iih.verified.json';
import { parseVerifiedCapability } from './poc-capability.js';

it('contains only verified XP-58IIH capabilities', () => {
  const parsed = parseVerifiedCapability(capability);
  expect(parsed.verificationStatus).toBe('PASSED');
  expect(parsed.selfTestReference).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
  if (parsed.supportsCut) expect(parsed.cutCommandHex).toMatch(/^[0-9a-f]+$/iu);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/capabilities/xinye-xp58iih.verified.spec.ts
```

Expected：FAIL，实测 fixture 尚不存在。

- [ ] **Step 3：执行真实打印机验收**

依次记录：自检型号与端口、GB18030、GBK、实际半角列数、中英文对齐、长商品名、备注、配送地址、走纸行数、切刀。只有真实通过的 encoding 写入 fixture；切刀未明确通过必须为 `false`。文档只记录脱敏自检引用，不记录门店 IP。

- [ ] **Step 4：运行阶段门**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/capabilities/xinye-xp58iih.verified.spec.ts
pnpm --filter @bake-mall/merchant-terminal verify:android
pnpm --filter @bake-mall/merchant-terminal test
pnpm --filter @bake-mall/merchant-terminal typecheck
pnpm --filter @bake-mall/merchant-terminal lint
pnpm --filter @bake-mall/merchant-terminal build
```

Expected：全部 PASS；真实纸张验收记录完整。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/src/capabilities docs/runbook/xinye-xp58iih-poc.md
git commit -m "test(terminal): record verified xp58iih capabilities"
```

## 计划 A 完成标准

- fake server 三种故障模式通过；
- UTS adapter 完整写入并正确分类中途断开；
- 真机中文、列宽、长文本和走纸通过；
- 切刀只在真实通过后启用；
- `xinye-xp58iih.verified.json` 已提交并被测试验证；
- 后续计划不得自行猜测端口、编码、列数、走纸或切刀值。
