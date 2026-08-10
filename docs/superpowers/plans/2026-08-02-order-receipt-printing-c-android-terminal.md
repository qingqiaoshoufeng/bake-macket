# 订单小票打印 C：Android 原生打印终端 Implementation Plan

> **面向执行代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务实施。所有步骤使用复选框跟踪。

**目标：** 在计划 A 的真机 PoC 基础上完成 uni-app Android 商家终端，其中 UTS/Kotlin Foreground Service 在 WebView 和 JS Runtime 不存在时仍能独立完成设备鉴权、任务领取、ledger、`/start`、ESC/POS 渲染、TCP 发送、ACK 和故障恢复。

**架构：** Vue/JS 只负责配对码输入、设置、诊断控制、脱敏状态展示和 Admin WebView；真实订单打印路径全部位于 `bake-print-runtime` 原生模块。`@bake-mall/contracts` 导出机器可读 wire manifest，构建时生成 UTS 类型和 validator，禁止人工维护第二套设备 DTO。Node/Vitest 参考模型只做快速规则测试，不参与发布时后台打印。

**技术栈：** uni-app Vue 3、UTS/Kotlin、Android Foreground Service、Android Keystore、app-private 原子存储、原生 HTTPS client、`java.net.Socket`、ESC/POS、GB18030/GBK、Vitest、fake API、fake TCP。

**前置：**

- 计划 A 已完成，`xinye-xp58iih.verified.json` 通过真实打印机验收；
- 计划 B Task 1 已发布 `@bake-mall/contracts` printing 类型与 `PRINTING_WIRE_MANIFEST_V1`；
- App 资源编译、HBuilderX CLI APK 包装和 adb 验证已经按计划 A 分离。

**权威规格：** `docs/superpowers/specs/2026-08-02-order-receipt-printing-design.md`

---

## 文件结构

```text
apps/merchant-terminal/
├─ pages/
│  ├─ pairing/                         配对码输入
│  ├─ terminal/                        Admin WebView
│  └─ printer-settings/                本机配置与诊断控制
├─ src/
│  ├─ pairing/                         Vue 配对 UI 六类职责目录
│  ├─ terminal/                        脱敏终端状态 UI
│  ├─ bridge/admin-web/                受限 WebView bridge
│  └─ reference/                       Node-only 纯规则/fixture 测试
├─ scripts/
│  ├─ generate-uts-wire.mjs            contracts manifest → UTS
│  ├─ verify-generated-wire.mjs        生成结果 diff gate
│  └─ run-terminal-smoke.mjs           fake API/TCP + adb
└─ uni_modules/bake-print-runtime/
   ├─ interface.uts                    仅暴露脱敏控制接口
   └─ utssdk/app-android/
      ├─ AndroidManifest.xml            Service/Receiver/权限
      ├─ generated/printing-wire.uts    自动生成，禁止手改
      ├─ auth/                          pair、credential、device token
      ├─ api/                           原生 Device API client
      ├─ ledger/                        原子本地账本
      ├─ receipt/                       原生 formatter/hash
      ├─ printer/                       原始 TCP adapter
      ├─ worker/                        claim/start/write/ack 状态机
      └─ service/                       Foreground Service/启动恢复
```

## 不可违反的边界

- Foreground Service 不得调用 Vue/JS `setInterval`、Promise loop 或 JS formatter 完成后台打印。
- JS Runtime 被销毁后，原生服务必须仍能完成一条完整任务。
- `/start` 成功前打印机写入字节数必须为 0。
- 配对 credential、短期 device token 和 lease token 不进入 Vue store、WebView、URL、localStorage 或普通日志。
- 生成的 UTS wire 文件不得手工编辑；contracts 变化必须重新生成并通过 diff gate。

### Task 1：从 contracts 生成 UTS wire types 和 validator

**文件：**

- 创建：`apps/merchant-terminal/scripts/generate-uts-wire.mjs`
- 创建：`apps/merchant-terminal/scripts/generate-uts-wire.test.mjs`
- 创建：`apps/merchant-terminal/scripts/verify-generated-wire.mjs`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/package.json`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/interface.uts`
- 生成：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/generated/printing-wire.uts`
- 创建：`apps/merchant-terminal/src/reference/wire-fixtures.ts`
- 修改：`apps/merchant-terminal/package.json`

- [ ] **Step 1：写生成器 RED 测试**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateUtsWire } from './generate-uts-wire.mjs';

const manifest = {
  version: 1,
  enums: { PrintJobStatus: ['PENDING', 'LEASED', 'SENDING'] },
  objects: {
    StartPrintJobResponse: {
      required: ['jobId', 'attemptNo', 'startedAt'],
      properties: {
        jobId: { type: 'string' },
        attemptNo: { type: 'integer', minimum: 1 },
        startedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
};

test('generates deterministic UTS types and validators', () => {
  const first = generateUtsWire(manifest);
  const second = generateUtsWire(structuredClone(manifest));
  assert.equal(first, second);
  assert.match(first, /type StartPrintJobResponse/);
  assert.match(first, /validateStartPrintJobResponse/);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
node --test apps/merchant-terminal/scripts/generate-uts-wire.test.mjs
```

Expected：FAIL，生成器尚不存在。

- [ ] **Step 3：实现确定性生成器**

生成器从构建后的 `@bake-mall/contracts` 导入 `PRINTING_WIRE_MANIFEST_V1`，按稳定 key 顺序生成：

```uts
export type StartPrintJobResponse = {
  jobId: string;
  attemptNo: number;
  startedAt: string;
};

export function validateStartPrintJobResponse(value: UTSJSONObject): StartPrintJobResponse;
```

必须覆盖 pair/token/heartbeat、claim/start/ack/recover、`PrintReceiptPayloadV1`、enum、联合判别键、整数范围和 nullable 字段。遇到不支持的 manifest construct 必须失败，不得降级为 `any`。

- [ ] **Step 4：建立生成 diff gate**

`package.json` 增加 workspace 依赖和生成门禁：

```json
{
  "dependencies": {
    "@bake-mall/contracts": "workspace:*"
  },
  "scripts": {
    "generate:uts-wire": "pnpm --filter @bake-mall/contracts build && node scripts/generate-uts-wire.mjs --write",
    "check:uts-wire": "node scripts/verify-generated-wire.mjs",
    "pretest": "pnpm check:uts-wire",
    "pretypecheck": "pnpm check:uts-wire",
    "prebuild:app-resources": "pnpm check:uts-wire"
  }
}
```

Task 1 修改 package 时必须与计划 A 已有 dependencies/devDependencies 合并，不得覆盖 DCloud 精确版本。由于 pnpm 的 pre/post hook 行为可能受配置影响，根 CI 和本计划最终门仍显式执行 `generate:uts-wire`/`check:uts-wire`，不只依赖隐式 pre-script。

```bash
pnpm --filter @bake-mall/contracts build
pnpm --filter @bake-mall/merchant-terminal generate:uts-wire
pnpm --filter @bake-mall/merchant-terminal check:uts-wire
node --test apps/merchant-terminal/scripts/generate-uts-wire.test.mjs
```

Expected：PASS；重新生成后 git diff 为空。故意修改 manifest 后 `check:uts-wire` 必须 FAIL。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/scripts apps/merchant-terminal/uni_modules/bake-print-runtime apps/merchant-terminal/src/reference apps/merchant-terminal/package.json
git commit -m "build(terminal): generate uts printing wire contracts"
```

### Task 2：实现原生配对、Keystore credential 和 token client

**文件：**

- 创建：`apps/merchant-terminal/pages/pairing/PairingPage.vue`
- 创建：`apps/merchant-terminal/src/pairing/components/PairingForm.vue`
- 创建：`apps/merchant-terminal/src/pairing/hooks/useDevicePairing.ts`
- 创建：`apps/merchant-terminal/src/pairing/hooks/useDevicePairing.spec.ts`
- 创建：`apps/merchant-terminal/src/pairing/mock/pairing.mock.ts`
- 创建：`apps/merchant-terminal/src/pairing/config/defaults.ts`
- 创建：`apps/merchant-terminal/src/pairing/type/index.ts`
- 创建：`apps/merchant-terminal/src/pairing/api/index.ts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/auth/DeviceCredentialStore.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/auth/DeviceAuthClient.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/api/HttpTransport.uts`
- 修改：`apps/merchant-terminal/uni_modules/bake-print-runtime/interface.uts`

- [ ] **Step 1：写 Vue 侧 secret 隔离 RED 测试**

```ts
it('receives only a redacted device view from native pairing', async () => {
  nativeRuntime.pair.mockResolvedValue({
    device: { id: 'device-1', name: '门店平板', status: 'ACTIVE' },
  });
  await pairing.submit('123456');
  expect(pairing.device.value?.id).toBe('device-1');
  expect(JSON.stringify(pairing)).not.toContain('credential');
  expect(JSON.stringify(pairing)).not.toContain('accessToken');
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/pairing
```

Expected：FAIL。

- [ ] **Step 3：实现原生闭环配对**

Vue 只调用：

```uts
export type PairTerminalResult = {
  device: RedactedPrintDeviceView;
};

export function pairTerminal(pairingCode: string): Promise<PairTerminalResult>;
export function clearTerminalPairing(): Promise<void>;
```

原生 `pairTerminal()` 直接调用 `/device/auth/pair`，校验生成 wire response，把 API 一次性返回的 256-bit credential 写入 Android Keystore，随后清除内存临时字节，只向 Vue 返回脱敏 device view。`DeviceAuthClient` 从 Keystore 读取 credential 换取短期 token，token 仅存原生内存/安全存储；401 时最多刷新一次，设备撤销时清理 token 并停止 worker。

- [ ] **Step 4：运行原生安全 gate**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/pairing
pnpm --filter @bake-mall/merchant-terminal build:app-resources
pnpm --filter @bake-mall/merchant-terminal package:android
pnpm --filter @bake-mall/merchant-terminal verify:android
```

Expected：配对成功；adb/logcat、Vue state、WebView storage 和 URL 中无 credential/token。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/pages/pairing apps/merchant-terminal/src/pairing apps/merchant-terminal/uni_modules/bake-print-runtime
git commit -m "feat(terminal): pair devices entirely in native runtime"
```

### Task 3：实现原生 receipt formatter 与 bytes hash

**文件：**

- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/receipt/DisplayWidth.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/receipt/ReceiptFormatter.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/receipt/ByteHash.uts`
- 创建：`apps/merchant-terminal/src/reference/receipt-reference.ts`
- 创建：`apps/merchant-terminal/src/reference/receipt-reference.spec.ts`
- 创建：`apps/merchant-terminal/src/reference/receipt-golden-fixtures.ts`
- 创建：`apps/merchant-terminal/scripts/verify-native-receipt.mjs`

- [ ] **Step 1：写 Node 参考模型和 golden RED 测试**

```ts
it.each([
  ['pickup', pickupPayload],
  ['delivery', deliveryPayload],
  ['reprint', reprintPayload],
])('defines the %s golden receipt', async (name, payload) => {
  const document = buildReferenceReceipt(
    payload,
    '2026-08-02T06:35:08.000Z',
    capability,
  );
  expect(document).toMatchSnapshot(name);
  expect(document.join('\n')).toContain('应付金额');
  expect(document.join('\n')).not.toContain('已支付');
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/reference/receipt-reference.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现原生 formatter**

```uts
export function renderReceipt(
  payload: PrintReceiptPayloadV1,
  startedAt: string,
  capability: PrinterCapabilityReport,
): ByteArray;

export function sha256Bytes(bytes: ByteArray): string;
```

原生 formatter 使用 A 的 verified fixture，覆盖 pickup/delivery、INITIAL/REPRINT、补打次数/原因、整数分格式化、手机号策略、控制字符、显示宽度、GB18030/GBK、走纸和可选切刀。不得回调 JS formatter。

- [ ] **Step 4：验证原生输出与 golden**

`verify-native-receipt.mjs` 通过测试 APK 调用原生 formatter，把 bytes hash 和脱敏文档摘要写到 test channel，与 Node golden 比较；真实 bytes 不进入普通日志。

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/reference/receipt-reference.spec.ts
pnpm --filter @bake-mall/merchant-terminal build:app-resources
pnpm --filter @bake-mall/merchant-terminal package:android
node apps/merchant-terminal/scripts/verify-native-receipt.mjs
```

Expected：三类 payload 的原生 bytes hash 稳定且真机中文正确。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/uni_modules/bake-print-runtime apps/merchant-terminal/src/reference apps/merchant-terminal/scripts/verify-native-receipt.mjs
git commit -m "feat(terminal): render receipts in native runtime"
```

### Task 4：实现原生 TCP adapter 和错误分类

**文件：**

- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/printer/PrinterSession.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/printer/TcpPrinterAdapter.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/printer/PrinterErrors.uts`
- 删除：`apps/merchant-terminal/uni_modules/bake-escpos-printer/`
- 创建：`apps/merchant-terminal/src/reference/printer-errors.ts`
- 创建：`apps/merchant-terminal/src/reference/printer-errors.spec.ts`

- [ ] **Step 1：写错误语义 RED 测试**

```ts
it.each([
  ['ETIMEDOUT', 0, 'PRINTER_CONNECT_TIMEOUT'],
  ['ECONNREFUSED', 0, 'PRINTER_CONNECTION_REFUSED'],
  ['EHOSTUNREACH', 0, 'PRINTER_HOST_UNREACHABLE'],
  ['ECONNRESET', 32, 'PRINTER_CONNECTION_LOST_DURING_WRITE'],
])('maps %s/%d to %s', (nativeCode, bytesWritten, expected) => {
  expect(classifyPrinterError({ nativeCode, bytesWritten })).toBe(expected);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/reference/printer-errors.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现原生 adapter**

```uts
export type NativeWriteResult = {
  bytesWritten: number;
  durationMs: number;
};

export class TcpPrinterSession {
  writeAll(bytes: ByteArray): NativeWriteResult;
  close(): void;
}
```

将计划 A 已验证的 PoC 连接/编码逻辑迁入 `bake-print-runtime` 后删除 `bake-escpos-printer`，仓库只保留一个生产 TCP/编码实现。原生 adapter 在 IO dispatcher 使用 `java.net.Socket`；连接、发送、关闭每任务一次。异常携带 nativeCode 和 bytesWritten；开始写入后的连接丢失一律不确定。adapter 不负责 API、ledger 或业务金额。

- [ ] **Step 4：运行 fake TCP Android gate**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/reference/printer-errors.spec.ts
node --test apps/merchant-terminal/scripts/fake-printer-server.test.mjs
pnpm --filter @bake-mall/merchant-terminal verify:android
```

Expected：完整接收、连接即断、N 字节后断开均正确分类。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/uni_modules/bake-print-runtime apps/merchant-terminal/src/reference
git commit -m "feat(terminal): add native raw tcp printer transport"
```

### Task 5：实现原生 ledger 与 crash recovery

**文件：**

- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/ledger/PrintLedger.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/ledger/LeaseSecretStore.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/ledger/RecoveryDecision.uts`
- 创建：`apps/merchant-terminal/src/reference/ledger-recovery.ts`
- 创建：`apps/merchant-terminal/src/reference/ledger-recovery.spec.ts`
- 创建：`apps/merchant-terminal/scripts/verify-ledger-crash.mjs`

- [ ] **Step 1：写恢复决策 RED 测试**

```ts
it.each([
  ['RECEIVED', 'RESUME_LEASED'],
  ['SENDING', 'REQUIRE_CONFIRMATION'],
  ['SENT', 'ACK_ONLY'],
  ['ACKED', 'IGNORE'],
] as const)('maps %s to %s', (state, action) => {
  expect(decideRecovery({ state })).toEqual({ action });
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/reference/ledger-recovery.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现原生原子 ledger**

```uts
export type LocalLedgerEntry = {
  jobId: string;
  payloadHash: string;
  state: 'RECEIVED' | 'SENDING' | 'SENT' | 'ACKED';
  receivedAt: string;
  sentAt: string | null;
  ackedAt: string | null;
  renderedBytesHash: string | null;
};
```

metadata 使用 app-private 原子文件替换或 SQLite transaction；credential/lease token 使用 Keystore 加密且与 metadata 分离。损坏返回 `LOCAL_LEDGER_CORRUPT`，不静默删除。原生服务是唯一 writer；Vue 只能读取聚合计数。

- [ ] **Step 4：运行强制终止恢复测试**

`verify-ledger-crash.mjs` 通过 adb 在四个写入边界强制终止进程并重启 Service，验证 RECEIVED/SENDING/SENT/ACKED 决策。

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/reference/ledger-recovery.spec.ts
pnpm --filter @bake-mall/merchant-terminal verify:android
node apps/merchant-terminal/scripts/verify-ledger-crash.mjs
```

Expected：SENDING 不重打，SENT 只补 ACK，损坏进入人工确认。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/uni_modules/bake-print-runtime apps/merchant-terminal/src/reference apps/merchant-terminal/scripts/verify-ledger-crash.mjs
git commit -m "feat(terminal): persist native crash-safe print ledger"
```

### Task 6：实现原生 Device API client 和 Worker 状态机

**文件：**

- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/api/DevicePrintApi.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/api/DevicePrintApiClient.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/worker/PrintWorker.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/worker/PollPolicy.uts`
- 创建：`apps/merchant-terminal/src/reference/worker-model.ts`
- 创建：`apps/merchant-terminal/src/reference/worker-model.spec.ts`

- [ ] **Step 1：写不可越过的 `/start` 顺序 RED 测试**

```ts
it('defines zero printer bytes before start succeeds', async () => {
  await model.tick();
  expect(calls).toEqual([
    'token',
    'claim',
    'ledger:received',
    'validate',
    'connect-zero-bytes',
    'api:start',
    'render-native',
    'ledger:sending',
    'printer:writeAll',
    'ledger:sent',
    'api:ack',
    'ledger:acked',
  ]);
  expect(bytesWrittenBeforeStart).toBe(0);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/reference/worker-model.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现原生 API 和 worker**

原生 `DevicePrintApiClient` 使用生成 validator 校验所有响应。`PrintWorker.tick()` 严格执行：

```text
token → claim → ledger RECEIVED → payload/capability 校验
→ TCP connect（零字节）→ API start → startedAt 原生渲染
→ ledger SENDING → writeAll → ledger SENT
→ ACK(renderedBytesHash) → ledger ACKED
```

`SENDING` 时原生 coroutine 心跳；空闲 3 秒；API 失败退避到 60 秒；网络 callback 恢复后立即 tick；401 最多刷新一次；设备撤销停止服务。`/start` 成功但 ledger 未改为 SENDING 时崩溃，恢复必须通过远端 SENDING 进入人工确认。

- [ ] **Step 4：运行 worker 状态矩阵**

覆盖成功、connect timeout、start 拒绝、write 中断、ACK 失败、payload mismatch、四种 ledger 恢复、多任务串行、token refresh 和设备撤销。

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/reference/worker-model.spec.ts
pnpm --filter @bake-mall/merchant-terminal verify:android
```

Expected：原生 trace 与参考模型一致；`/start` 前 fake printer 接收 0 字节。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/uni_modules/bake-print-runtime apps/merchant-terminal/src/reference
git commit -m "feat(terminal): enforce native leased-to-sending worker"
```

### Task 7：实现独立 Foreground Service 生命周期

**文件：**

- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/AndroidManifest.xml`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/service/PrintForegroundService.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/service/BootReceiver.uts`
- 创建：`apps/merchant-terminal/uni_modules/bake-print-runtime/utssdk/app-android/service/ServiceController.uts`
- 创建：`apps/merchant-terminal/src/reference/service-prerequisites.ts`
- 创建：`apps/merchant-terminal/src/reference/service-prerequisites.spec.ts`
- 修改：`apps/merchant-terminal/uni_modules/bake-print-runtime/interface.uts`

- [ ] **Step 1：写启动门禁 RED 测试**

```ts
it.each([
  ['UNPAIRED', { paired: false }],
  ['DEVICE_DISABLED', { deviceActive: false }],
  ['DIAGNOSTIC_REQUIRED', { diagnosticPassed: false }],
  ['NOTIFICATION_REQUIRED', { notificationAllowed: false }],
])('blocks service with %s', (reason, override) => {
  expect(checkServicePrerequisites({ ...healthy, ...override })).toEqual({
    canStart: false,
    reason,
  });
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/reference/service-prerequisites.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现原生 Service**

Manifest 声明 `INTERNET`、网络状态、`FOREGROUND_SERVICE`、target SDK 对应 service type/permission、`POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`，并注册 Service/Receiver。Service 在 `onStartCommand` 中及时 `startForeground()`，直接持有原生 worker 和 coroutine scope；返回符合恢复策略的启动模式。Service controller 仅向 Vue 暴露：

```uts
export function startPrintService(): Promise<void>;
export function stopPrintService(): Promise<void>;
export function getTerminalStatus(): Promise<RedactedTerminalStatus>;
```

不得把 worker callback 交给 JS 执行。

- [ ] **Step 4：验证 JS Runtime 消失后的独立运行**

Android 测试依次：启动服务→销毁 WebView/Activity→终止并重建 JS Runtime（不强停原生 Service）→API 注入任务→确认原生服务 claim/start/print/ack。另测后台、锁屏、进程重建、开机恢复；系统强行停止后只要求下次打开告警。

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/reference/service-prerequisites.spec.ts
pnpm --filter @bake-mall/merchant-terminal build:app-resources
pnpm --filter @bake-mall/merchant-terminal package:android
pnpm --filter @bake-mall/merchant-terminal verify:android
```

Expected：无 JS Runtime 时仍完成任务；通知持续存在；强停边界如实报告。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/uni_modules/bake-print-runtime apps/merchant-terminal/src/reference
git commit -m "feat(terminal): run worker inside native foreground service"
```

### Task 8：实现设置 UI、Admin WebView 和受限桥接

**文件：**

- 创建：`apps/merchant-terminal/pages/terminal/TerminalPage.vue`
- 创建：`apps/merchant-terminal/pages/printer-settings/PrinterSettingsPage.vue`
- 创建：`apps/merchant-terminal/src/terminal/components/TerminalStatusCard.vue`
- 创建：`apps/merchant-terminal/src/terminal/hooks/useTerminalStatus.ts`
- 创建：`apps/merchant-terminal/src/terminal/hooks/useTerminalStatus.spec.ts`
- 创建：`apps/merchant-terminal/src/terminal/mock/terminal.mock.ts`
- 创建：`apps/merchant-terminal/src/terminal/config/defaults.ts`
- 创建：`apps/merchant-terminal/src/terminal/type/index.ts`
- 创建：`apps/merchant-terminal/src/terminal/api/index.ts`
- 创建：`apps/merchant-terminal/src/bridge/admin-web/bridge.ts`
- 创建：`apps/merchant-terminal/src/bridge/admin-web/bridge.spec.ts`
- 修改：`apps/merchant-terminal/pages.json`

- [ ] **Step 1：写 bridge/脱敏状态 RED 测试**

```ts
it('rejects arbitrary native actions and secrets', async () => {
  await expect(
    handleAdminBridgeMessage(message('CONNECT_TCP'), context),
  ).resolves.toMatchObject({ ok: false });
  await expect(
    handleAdminBridgeMessage(message('READ_DEVICE_CREDENTIAL'), context),
  ).resolves.toMatchObject({ ok: false });
  expect(JSON.stringify(await terminal.getStatus())).not.toMatch(
    /credential|leaseToken|accessToken/u,
  );
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/terminal src/bridge/admin-web
```

Expected：FAIL。

- [ ] **Step 3：实现 UI 与五个白名单 action**

只接受 `GET_TERMINAL_STATUS`、`OPEN_PRINTER_SETTINGS`、`PRINT_TEST_PAGE`、`START_PRINT_SERVICE`、`STOP_PRINT_SERVICE`；校验 Admin HTTPS origin、schema、timestamp 和 messageId 幂等；测试页限频。Vue 只通过原生 interface 读脱敏状态、保存打印机配置、触发诊断和控制 Service。真实订单任务不经过 bridge。

- [ ] **Step 4：运行 UI/bridge 门禁**

```bash
pnpm --filter @bake-mall/merchant-terminal test -- src/terminal src/bridge/admin-web
pnpm --filter @bake-mall/merchant-terminal typecheck
pnpm --filter @bake-mall/merchant-terminal lint
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/pages apps/merchant-terminal/src/terminal apps/merchant-terminal/src/bridge apps/merchant-terminal/pages.json
git commit -m "feat(terminal): expose redacted native runtime controls"
```

### Task 9：建立无 JS Runtime 的终端独立验收

**文件：**

- 创建：`apps/merchant-terminal/scripts/fake-device-api.mjs`
- 创建：`apps/merchant-terminal/scripts/fake-device-api.test.mjs`
- 创建：`apps/merchant-terminal/scripts/run-terminal-smoke.mjs`
- 创建：`apps/merchant-terminal/scripts/run-terminal-smoke.test.mjs`
- 创建：`apps/merchant-terminal/docs/native-runtime-acceptance.md`

- [ ] **Step 1：写独立运行场景 RED 测试**

```js
for (const scenario of [
  'SUCCESS_WITHOUT_WEBVIEW',
  'CONNECT_TIMEOUT',
  'MID_WRITE_DROP',
  'ACK_LOST',
  'RESTART_RECEIVED',
  'RESTART_SENDING',
  'RESTART_SENT',
  'PAYLOAD_HASH_MISMATCH',
  'DEVICE_REVOKED',
]) {
  test(scenario, async () => {
    const result = await runScenario(scenario);
    assert.equal(result.unsafeDuplicateWrites, 0);
  });
}
```

- [ ] **Step 2：运行并确认 RED**

```bash
node --test apps/merchant-terminal/scripts/fake-device-api.test.mjs apps/merchant-terminal/scripts/run-terminal-smoke.test.mjs
```

Expected：FAIL。

- [ ] **Step 3：实现 fake API/TCP + adb smoke**

脚本安装调试 APK、完成原生配对、启动 Service、销毁 Activity/WebView、向 fake API 注入任务，并验证原生 API trace、fake printer bytes hash、ledger 和通知。每个场景独立清理，不把 secret 写入输出。

- [ ] **Step 4：运行计划 C 全门禁**

```bash
pnpm --filter @bake-mall/contracts build
pnpm --filter @bake-mall/merchant-terminal generate:uts-wire
pnpm --filter @bake-mall/merchant-terminal check:uts-wire
pnpm --filter @bake-mall/merchant-terminal test
pnpm --filter @bake-mall/merchant-terminal typecheck
pnpm --filter @bake-mall/merchant-terminal lint
pnpm --filter @bake-mall/merchant-terminal build
pnpm --filter @bake-mall/merchant-terminal build:app-resources
pnpm --filter @bake-mall/merchant-terminal package:android
pnpm --filter @bake-mall/merchant-terminal verify:android
node apps/merchant-terminal/scripts/run-terminal-smoke.mjs
```

Expected：全部 PASS；`SUCCESS_WITHOUT_WEBVIEW` 证明 JS Runtime 不参与后台打印。

- [ ] **Step 5：提交**

```bash
git add apps/merchant-terminal/scripts apps/merchant-terminal/docs
git commit -m "test(terminal): verify native printing without js runtime"
```

## 计划 C 完成标准

- UTS wire types/validators 由 contracts manifest 自动生成且 diff clean；
- 配对 credential、device token、lease token 不经过 Vue/WebView；
- formatter、ledger、API client、worker 和 TCP 全部位于原生 runtime；
- `/start` 成功前打印机收到 0 字节；
- SENDING/ACK 崩溃窗口不会自动重复打印；
- Foreground Service 在 WebView/JS Runtime 被销毁、后台、锁屏和重启场景下工作；
- fake API + fake TCP + adb 的 `SUCCESS_WITHOUT_WEBVIEW` 和故障矩阵通过。
