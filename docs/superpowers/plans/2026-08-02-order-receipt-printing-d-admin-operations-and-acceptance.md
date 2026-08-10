# 订单小票打印 D：Admin 运营闭环与验收 Implementation Plan

> **面向执行代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务实施。所有步骤使用复选框跟踪。

**目标：** 完成 Admin 打印设置、设备管理、订单打印状态和补打交互，接入受限终端桥接，落实生产配置和 180 天 PII 脱敏，完成 Playwright、真实 API/Android/XP-58IIH 全链路验收及门店 runbook。

**架构：** Admin 只调用持久化打印 API；终端 bridge 仅提供本机诊断/服务控制，不直接打印真实订单。部署先迁移和发布 API/Admin/Android，现场配对与诊断通过后才开启自动打印。保留任务摘要和 hash，180 天后移除打印 payload 中 PII。

**技术栈：** Vue 3、Vite、Element Plus、Vitest、Playwright、NestJS、TypeORM/MySQL、uni-app Android、Docker/Nginx。

**前置：** 计划 B、C 完成。

---

### Task 1：建立 Admin 打印设置与设备模块

**文件：**

- 创建：`apps/admin-web/src/views/printing/PrintingView.vue`
- 创建：`apps/admin-web/src/views/printing/components/PrintDeviceTable.vue`
- 创建：`apps/admin-web/src/views/printing/components/PrintSettingsForm.vue`
- 创建：`apps/admin-web/src/views/printing/components/PairingCodeDialog.vue`
- 创建：`apps/admin-web/src/views/printing/hooks/usePrintDevices.ts`
- 创建：`apps/admin-web/src/views/printing/hooks/usePrintDevices.spec.ts`
- 创建：`apps/admin-web/src/views/printing/hooks/usePrintSettings.ts`
- 创建：`apps/admin-web/src/views/printing/hooks/usePrintSettings.spec.ts`
- 创建：`apps/admin-web/src/views/printing/mock/devices.mock.ts`
- 创建：`apps/admin-web/src/views/printing/config/columns.ts`
- 创建：`apps/admin-web/src/views/printing/config/defaults.ts`
- 创建：`apps/admin-web/src/views/printing/type/index.ts`
- 创建：`apps/admin-web/src/views/printing/api/index.ts`
- 创建：`apps/admin-web/src/views/printing/index.ts`
- 修改：`apps/admin-web/src/router/index.ts`
- 修改：`apps/admin-web/src/config/navigation.ts`

- [ ] **Step 1：写设备和设置 hook RED 测试**

```ts
it('does not enable automatic printing without a healthy device', async () => {
  const printing = usePrintSettings({
    api,
    now: () => Date.parse('2026-08-02T08:00:00Z'),
  });
  await printing.load();
  expect(printing.canEnableAutomatic.value).toBe(false);
  expect(printing.enableBlockReason.value).toBe(
    '需要一台最近 60 秒在线且诊断通过的设备',
  );
});

it('never exposes a device credential', async () => {
  await devices.load();
  expect(JSON.stringify(devices.devices.value)).not.toContain('credential');
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/printing
```

Expected：FAIL。

- [ ] **Step 3：实现六类职责目录**

```ts
export function usePrintDevices(): Readonly<{
  devices: Readonly<Ref<readonly PrintDeviceView[]>>;
  load: () => Promise<void>;
  createPairingCode: () => Promise<PairingCodeView>;
  updateDevice: (id: string, input: UpdatePrintDeviceRequest) => Promise<void>;
  revokeDevice: (id: string) => Promise<void>;
}>;
```

API 只拼路径和共享 DTO；hooks 做并发隔离、派生与不可变状态；组件不 fetch。新增 `/printing` 受 Admin guard 保护并加入导航。启用按钮显示在线/诊断前置，version conflict 保留草稿并提供重载。

- [ ] **Step 4：运行 Admin 门禁**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/printing
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add apps/admin-web/src/views/printing apps/admin-web/src/router/index.ts apps/admin-web/src/config/navigation.ts
git commit -m "feat(admin): add print device and settings workspace"
```

### Task 2：在订单详情完成打印运营闭环

**文件：**

- 创建：`apps/admin-web/src/views/orders/components/OrderPrintingPanel.vue`
- 创建：`apps/admin-web/src/views/orders/components/ReprintDialog.vue`
- 创建：`apps/admin-web/src/views/orders/components/PrintAttemptHistory.vue`
- 创建：`apps/admin-web/src/views/orders/hooks/useOrderPrinting.ts`
- 创建：`apps/admin-web/src/views/orders/hooks/useOrderPrinting.spec.ts`
- 修改：`apps/admin-web/src/views/orders/components/OrderDetailDrawer.vue`
- 修改：`apps/admin-web/src/views/orders/components/OrderDetailDrawer.spec.ts`
- 修改：`apps/admin-web/src/views/orders/api/index.ts`
- 修改：`apps/admin-web/src/views/orders/OrdersView.vue`
- 修改：`apps/admin-web/src/constants/labels.ts`

- [ ] **Step 1：写状态到操作 RED 测试**

```ts
it.each([
  ['PENDING', ['PRINT_NOW']],
  ['LEASED', []],
  ['SENDING', []],
  ['RETRY', ['PRINT_NOW']],
  ['PRINTED', ['REPRINT']],
  ['NEEDS_CONFIRMATION', ['CONFIRM_PRINTED', 'REPRINT']],
  ['DEAD', ['SAFE_RETRY']],
] as const)('maps %s to %j', (status, expected) => {
  expect(derivePrintActions(job({ status }), true)).toEqual(expected);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/orders/hooks/useOrderPrinting.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现打印 panel 和补打 dialog**

`derivePrintActions()` 是纯函数。补打必须原因；其他原因必须说明。无在线设备显示告警但不移除任务。`LEASED/SENDING` 禁止重复；`PRINTED` 只允许补打；待确认的“确认已打印”与“创建补打”语义分开。详情 drawer 打开时加载打印记录，并用 sequence 防止旧请求覆盖新订单。

- [ ] **Step 4：运行订单 UI 测试**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/orders/hooks/useOrderPrinting.spec.ts src/views/orders/components/OrderDetailDrawer.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add apps/admin-web/src/views/orders apps/admin-web/src/constants/labels.ts
git commit -m "feat(admin): close order printing recovery workflow"
```

### Task 3：接入终端 bridge 并适配 Android 窄屏

**文件：**

- 创建：`apps/admin-web/src/bridge/terminal.ts`
- 创建：`apps/admin-web/src/bridge/terminal.spec.ts`
- 创建：`apps/admin-web/src/views/printing/components/TerminalStatusCard.vue`
- 修改：`apps/admin-web/src/layouts/AdminLayout.vue`
- 修改：`apps/admin-web/src/layouts/AdminLayout.spec.ts`
- 修改：`apps/admin-web/src/views/printing/PrintingView.vue`

- [ ] **Step 1：写浏览器降级和白名单 RED 测试**

```ts
it('degrades safely outside the Android terminal', async () => {
  const bridge = createTerminalBridge({ window: {} as Window });
  await expect(bridge.getStatus()).resolves.toEqual({ available: false });
  await expect(bridge.printTestPage()).rejects.toMatchObject({
    code: 'TERMINAL_UNAVAILABLE',
  });
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/bridge/terminal.spec.ts src/layouts/AdminLayout.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现受限 bridge client**

```ts
export interface TerminalBridge {
  getStatus(): Promise<TerminalStatusView>;
  openPrinterSettings(): Promise<void>;
  printTestPage(): Promise<void>;
  startPrintService(): Promise<void>;
  stopPrintService(): Promise<void>;
}
```

只产生规格的五个 action，messageId 唯一，超时清理。普通浏览器显示说明而不崩溃。AdminLayout 在 Android 窄屏提供可用导航和内部滚动；不关闭全站 body 滚动，不破坏 Dialog/Drawer。

- [ ] **Step 4：运行 bridge、布局和浏览器验证**

```bash
pnpm --filter @bake-mall/admin-web test -- src/bridge/terminal.spec.ts src/layouts/AdminLayout.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web build
```

用 Chrome DevTools 在 800×1280 和 412×915 验证 `/printing`、`/orders` 和详情 drawer，无横向页面溢出、无控制台错误。

- [ ] **Step 5：提交**

```bash
git add apps/admin-web/src/bridge apps/admin-web/src/layouts apps/admin-web/src/views/printing
git commit -m "feat(admin): integrate restricted terminal bridge"
```

### Task 4：完成生产配置与 Android 发布契约

**文件：**

- 创建：`apps/merchant-terminal/scripts/verify-release-config.mjs`
- 创建：`apps/merchant-terminal/scripts/verify-release-config.test.mjs`
- 修改：`apps/merchant-terminal/scripts/package-android.mjs`
- 创建：`apps/merchant-terminal/scripts/package-android.test.mjs`
- 创建：`docs/runbook/merchant-terminal-release.md`
- 修改：`.env.development.example`
- 修改：`.env.production.example`
- 修改：`apps/api/src/config/env.schema.ts`
- 修改：`docs/runbook/deployment.md`
- 修改：`scripts/verify-workspace.mjs`
- 修改：`package.json`

- [ ] **Step 1：写 release config RED 测试**

```js
it('requires HTTPS endpoints and rejects printer credentials in build config', () => {
  assert.throws(() =>
    validateReleaseConfig({ ADMIN_WEB_URL: 'http://admin.example.com' }),
  );
  assert.throws(() => validateReleaseConfig({ PRINTER_IP: '192.168.1.8' }));
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
node --test apps/merchant-terminal/scripts/verify-release-config.test.mjs
```

Expected：FAIL。

- [ ] **Step 3：实现生产契约**

API env 增加 `JWT_DEVICE_SECRET`、`JWT_DEVICE_EXPIRES_IN_SECONDS`；终端 build config 增加 `ADMIN_WEB_URL`、`DEVICE_API_BASE_URL`，生产必须 HTTPS。禁止将打印机 IP、credential、配对码打入 env/APK。根普通 build 使用 host-safe 终端脚本；新增独立 `build:android-terminal-resources`、`package:android-terminal` 和 `verify:android-terminal`。

`build:android-terminal-resources` 仅调用 uni CLI 生成 App Android 资源；`package:android-terminal` 包装 HBuilderX CLI `pack --config` 生成签名 APK/AAB，并验证 HBuilderX 版本、登录、受忽略的签名配置和输出校验和；`verify:android-terminal` 通过 adb 安装已经生成的调试 APK 并运行 smoke。三个阶段的日志和退出码必须分别报告，不得把资源编译成功描述成 APK 发布成功。证书、alias 和密码只存在 CI secret/本机受忽略配置。

- [ ] **Step 4：运行 workspace、镜像和 release gate**

```bash
node --test apps/merchant-terminal/scripts/verify-release-config.test.mjs apps/merchant-terminal/scripts/package-android.test.mjs
pnpm verify:workspace
pnpm --filter @bake-mall/merchant-terminal build
pnpm --filter @bake-mall/merchant-terminal verify-release-config
pnpm --filter @bake-mall/merchant-terminal build:app-resources
pnpm --filter @bake-mall/merchant-terminal package:android
docker build -f apps/api/Dockerfile -t bake-mall-api:printing-verify .
```

Expected：host-safe、App 资源、HBuilderX 包装分别 PASS；签名 APK/AAB 和 SHA-256 产出；API 镜像不复制 Android 工程。缺少 HBuilderX 登录或签名 secret 时必须明确 FAIL，不可跳过后宣称发布门通过。

- [ ] **Step 5：提交**

```bash
git add .env.development.example .env.production.example apps/api/src/config/env.schema.ts apps/merchant-terminal/scripts docs/runbook/merchant-terminal-release.md docs/runbook/deployment.md scripts/verify-workspace.mjs package.json
git commit -m "chore(deploy): add merchant terminal production contract"
```

### Task 5：实现 180 天 payload PII 脱敏

**文件：**

- 创建：`apps/api/src/printing/print-retention.service.ts`
- 创建：`apps/api/src/printing/print-retention.service.spec.ts`
- 创建：`apps/api/src/printing/run-print-retention.ts`
- 创建：`apps/api/test/print-retention-mysql.e2e-spec.ts`
- 修改：`apps/api/package.json`
- 修改：`docs/runbook/deployment.md`

- [ ] **Step 1：写终态与 PII RED 测试**

```ts
it('redacts only terminal jobs older than 180 days', async () => {
  const result = await service.redactExpiredPayloads(cutoff, 100);
  expect(result).toEqual({ scanned: 2, redacted: 1 });
  const redacted = await jobs.findOneByOrFail({ id: oldPrinted.id });
  expect(JSON.stringify(redacted.payloadJson)).not.toContain('13800000000');
  expect(redacted.payloadHash).toBe(oldPrinted.payloadHash);
  expect(
    (await jobs.findOneByOrFail({ id: pending.id })).payloadJson,
  ).not.toBeNull();
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-retention.service.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现批量脱敏命令**

```ts
redactExpiredPayloads(
  cutoff: Date,
  batchSize: number,
): Promise<Readonly<{ scanned: number; redacted: number }>>;
```

只处理 180 天前 PRINTED/DEAD 等终态；先写不含 PII 的 audit summary，再移除联系人、电话、地址、备注。保留状态、时间、设备、模板、payload hash、bytes hash、错误码。日志不输出旧 payload。

- [ ] **Step 4：运行单元和真实 MySQL**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-retention.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- print-retention-mysql.e2e-spec.ts
```

Expected：PASS，临时 schema/grant 清理。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/test/print-retention-mysql.e2e-spec.ts apps/api/package.json docs/runbook/deployment.md
git commit -m "feat(api): redact expired receipt payload pii"
```

### Task 6：建立 Playwright + fake terminal 全链路

**文件：**

- 创建：`scripts/fake-print-terminal.mjs`
- 创建：`scripts/fake-print-terminal.test.mjs`
- 创建：`tests/e2e/receipt-printing.spec.ts`
- 修改：`scripts/e2e-runner.mjs`
- 修改：`package.json`

- [ ] **Step 1：写 fake terminal protocol RED 测试**

```js
it('claims, starts and acknowledges exactly one job', async () => {
  const result = await runFakeTerminal({
    apiUrl,
    pairingCode,
    mode: 'SUCCESS',
  });
  assert.deepEqual(result.actions, ['PAIR', 'TOKEN', 'CLAIM', 'START', 'ACK']);
  assert.equal(result.unsafeDuplicatePrints, 0);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
node --test scripts/fake-print-terminal.test.mjs
```

Expected：FAIL。

- [ ] **Step 3：实现 fake terminal 与 Playwright 流程**

E2E 精确执行：Admin 登录→配对→终端 heartbeat/诊断→启用自动→顾客下单→generation 0 与订单同时出现→claim/start/ack→Admin 显示已打印→补打含标记/原因→模拟 write 后 ACK 丢失→NEEDS_CONFIRMATION 且不自动重打。

- [ ] **Step 4：运行 E2E**

```bash
node --test scripts/fake-print-terminal.test.mjs
pnpm test:e2e
```

Expected：PASS，无 console error，无遗留测试 schema/user/grant。

- [ ] **Step 5：提交**

```bash
git add scripts/fake-print-terminal.mjs scripts/fake-print-terminal.test.mjs scripts/e2e-runner.mjs tests/e2e/receipt-printing.spec.ts package.json
git commit -m "test(e2e): verify receipt printing operations loop"
```

### Task 7：完成门店真机验收和运行手册

**文件：**

- 创建：`docs/runbook/receipt-printing-store-installation.md`
- 创建：`docs/runbook/receipt-printing-troubleshooting.md`
- 创建：`docs/runbook/receipt-printing-acceptance.md`
- 修改：`docs/runbook/deployment.md`

- [ ] **Step 1：创建不可跳过的验收矩阵**

```markdown
- [ ] XP-58IIH 自检型号、端口与 capability fixture 一致
- [ ] 前台自动打印
- [ ] 后台自动打印
- [ ] 锁屏自动打印
- [ ] 打印机断电后任务不丢
- [ ] Wi-Fi 恢复后安全续打
- [ ] App 重启时 RECEIVED/SENDING/SENT 恢复正确
- [ ] 双设备不重复领取
- [ ] SENDING 过期进入人工确认
- [ ] 补打含操作者、原因和票面标记
- [ ] device 撤销立即阻断
- [ ] WebView 无法读取 secret
```

- [ ] **Step 2：运行全量自动门禁**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm --filter @bake-mall/api migration:run
pnpm --filter @bake-mall/merchant-terminal verify:android
docker build -f apps/api/Dockerfile -t bake-mall-api:printing-final .
docker build -f infra/api.Dockerfile -t bake-mall-api:printing-compat-final .
```

Expected：全部 PASS；若某项失败，不得勾选验收项。

- [ ] **Step 3：执行真实门店矩阵**

按安装文档固定 Android 终端与打印机 Wi-Fi，逐项测试前台、后台、锁屏、断电、断网、重启、双设备、补打、不确定窗口、撤销、中文、长文本和金额。每项记录时间、App/API 版本和脱敏结果，不记录门店 secret。

- [ ] **Step 4：验证部署顺序和回滚**

顺序固定：备份 MySQL→同一 API 镜像执行生产迁移→启动 API→health→发布 Admin→发布签名 APK→配对→现场诊断→最后开启自动打印。回滚时先关闭 `auto_print_enabled`，不删除历史 jobs，再回滚应用；schema 只按迁移安全策略处理。

- [ ] **Step 5：提交**

```bash
git add docs/runbook
git commit -m "docs(ops): complete receipt printing rollout runbooks"
```

## 计划 D 完成标准

- Admin 完成设置、设备、状态、初打、补打和人工确认；
- Android 窄屏 Admin 可用，普通浏览器安全降级；
- 生产 config 不包含打印机 IP/secret；
- 180 天后打印 payload PII 被脱敏而审计摘要保留；
- Playwright + fake terminal 全链路通过；
- 真实 XP-58IIH 完成全部门店验收；
- 自动打印只在部署、配对和现场诊断通过后开启。
