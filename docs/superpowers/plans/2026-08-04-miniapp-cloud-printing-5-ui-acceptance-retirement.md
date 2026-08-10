# 打印双端 UI、真实验收与旧路径退役 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended); alternatively use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Admin Web 和同一个原生小程序交付单张/批量云打印运营闭环，通过花生壳体验版和真实芯烨云打印机验收后，安全退役 Android/TCP 旧方案。

**Architecture:** 两端共享 contracts，均由页面显式拉动 process-next-chunk。Admin Web 扩展现有 orders 六职责模块并新增 batches 页面；小程序新增原生订单/批次页。真实验收覆盖纸面验证码、100 张批量、断点继续和 UNKNOWN 人工处置；只有验收签字后执行旧方案删除。

**Tech Stack:** Vue 3 + Element Plus、原生微信小程序 TypeScript、Playwright/Vitest、花生壳 HTTPS、真实芯烨云 API/打印机。

**前置：** 前四份计划全部阶段门通过；芯烨云账号、`user/UserKEY` 和兼容云打印机可用。

**前端稳定幂等键生命周期（双端硬约束）：** 每个用户触发的逻辑写操作创建一个 UUID `Idempotency-Key`，并保存到 hook/runner 的不可变 operation state；单张打印、batch create、每个 append chunk、seal、每一次 process、cancel、queryUnknown、每次 manualResolution、每次 retry 各自拥有独立 key。timeout、断线、响应丢失或无法判断服务端是否已处理时，重试必须复用该逻辑操作的原 key，不能创建新 key；只有收到确定的 `COMPLETED` 或 `FAILED` 稳定响应后才释放，`UNKNOWN` 必须保留到对应 reconcile 收敛。再次明确点击或进入下一个 chunk/process/manual/retry 是新的逻辑操作，创建新 UUID。所有 RED 测试不只断言 client 参数，还必须由 mock API 捕获 HTTP header，证明不确定结果后的两次请求实际收到相同 `Idempotency-Key`。

**最小恢复持久化（双端硬约束）：** Admin Web 的 `sessionStorage` 与小程序 storage 对批次进度都只允许保存 `{ batchId, pendingOperationKeys: [{ operation, resourceId?, chunkIndex?, idempotencyKey }] }`；不得保存 token、订单内容、手机号、地址、备注、SN 或其他 PII。页面离开/Admin 刷新或小程序 `onHide/onUnload` 后不自动重放；重进时由管理员手动继续并复用未完成 key。确定 `COMPLETED`/`FAILED` 后删除对应 key，`UNKNOWN` 持续保留到 reconcile；批次全部稳定收敛、显式放弃本地恢复或退出登录时清除持久化 state。

---

## 文件结构

```text
apps/admin-web/src/views/orders/
├─ components/OrderPrintDialog.vue
├─ components/PrintBatchProgress.vue
├─ components/ManualPrintReviewDialog.vue
├─ hooks/useOrderPrinting.ts
├─ hooks/usePrintBatchRunner.ts
└─ api/index.ts

apps/admin-web/src/views/printing-batches/{components,hooks,mock,config,type,api}/

apps/miniapp-shell/admin/{components,hooks,mock,config,type,api}/printing*
apps/miniapp-shell/pages/admin-orders/*
apps/miniapp-shell/pages/admin-order-detail/*
apps/miniapp-shell/pages/admin-print-batch/*

scripts/fake-xpyun-terminal.mjs
tests/e2e/cloud-printing.spec.ts
docs/runbook/cloud-printing-*.md
```

### Task 1：扩展 Admin 订单 API 与打印机选择

**Files:**

- Modify: `apps/admin-web/src/views/orders/api/index.ts`
- Modify: `apps/admin-web/src/views/orders/api/index.spec.ts`
- Modify: `apps/admin-web/src/views/orders/type/index.ts`
- Create: `apps/admin-web/src/views/orders/hooks/useOrderPrinting.ts`
- Create: `apps/admin-web/src/views/orders/hooks/useOrderPrinting.spec.ts`
- Create: `apps/admin-web/src/views/orders/components/OrderPrintDialog.vue`
- Modify: `apps/admin-web/src/views/orders/components/OrderDetailDrawer.vue`
- Modify: `apps/admin-web/src/views/orders/components/OrderDetailDrawer.spec.ts`

- [ ] **Step 0：加载前端项目技能**

执行本 Task 前，必须通过 Skill 调用；CLI 不支持 Skill 时读取项目 skill 加载 `frontend-page-generator` 与 `js-functional-style`；按项目允许方式记录已加载结果。保持既有/新增页面的 `components/hooks/mock/config/type/api` 六职责边界，API 只组合全局 client，runner 与状态转换使用不可变数据和命名纯函数。

- [ ] **Step 1：写单张打印 RED 测试**

覆盖只列 ACTIVE、30秒在线；记住 adminId→printerId；已解绑清除；CANCELLED禁用；ACCEPTED 文案“厂商已接受”；UNKNOWN 不提供直接重打；再次明确打印 sequence。单张打印每次明确点击创建独立 UUID 并存入 hook 不可变 state；timeout、断线或响应丢失重试复用原 key，mock API 断言两次 HTTP 请求收到相同 `Idempotency-Key`；确定 `COMPLETED`/`FAILED` 后释放，`UNKNOWN` 保留到 reconcile，再次明确打印才生成新 key。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/orders/hooks/useOrderPrinting.spec.ts src/views/orders/components/OrderDetailDrawer.spec.ts
```

- [ ] **Step 3：实现 hook/dialog**

API 仅路径；hook 处理选择、在线刷新和 submit；dialog 不 fetch。`localStorage` 仅保存 `{ adminId, printerId }`；`sessionStorage` 可按本计划统一规则保存未稳定收敛的 operation key（批次只保存 `{ batchId, pendingOperationKeys }`）。两者都不得保存 SN、token、payload 或其他 PII。

- [ ] **Step 4：运行测试**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/orders
pnpm --filter @bake-mall/admin-web typecheck
```

- [ ] **Step 5：提交**

```bash
git add apps/admin-web/src/views/orders
git commit -m "feat(admin): print individual cloud receipts"
```

### Task 2：实现 Admin 批量打印 runner

**Files:**

- Modify: `apps/admin-web/src/views/orders/components/OrderTable.vue`
- Modify: `apps/admin-web/src/views/orders/components/OrderTable.spec.ts`
- Modify: `apps/admin-web/src/views/orders/OrdersView.vue`
- Create: `apps/admin-web/src/views/orders/hooks/usePrintBatchRunner.ts`
- Create: `apps/admin-web/src/views/orders/hooks/usePrintBatchRunner.spec.ts`
- Create: `apps/admin-web/src/views/orders/components/PrintBatchProgress.vue`
- Create: `apps/admin-web/src/views/orders/components/ManualPrintReviewDialog.vue`

- [ ] **Step 0：加载前端项目技能**

执行本 Task 前，必须通过 Skill 调用；CLI 不支持 Skill 时读取项目 skill 加载 `frontend-page-generator` 与 `js-functional-style`；按项目允许方式记录已加载结果。保持既有/新增页面的 `components/hooks/mock/config/type/api` 六职责边界，API 只组合全局 client，runner 与状态转换使用不可变数据和命名纯函数。

- [ ] **Step 1：写 batch runner RED 测试**

```ts
it('appends, seals, then processes until the batch pauses or completes', async () => {
  await runner.start(orderIds);
  expect(api.calls()).toEqual([
    'create',
    'append:100',
    'append:40',
    'seal',
    'process',
    'process',
  ]);
});
```

覆盖产品无总上限、append chunk 100、process 服务端 20、页面离开 guard、关闭后不自动继续、重进手动继续、单项失败继续、`MANUAL_REVIEW` 三类操作、`UNKNOWN` 无直接重打，最终只显示 `COMPLETED`、`COMPLETED_WITH_ISSUES` 两种完整状态，不使用 `ISSUES` 别名。对 create、每个 append chunk、seal、每一次 process、cancel、queryUnknown、每次 manualResolution、每次 retry 分别断言独立 UUID；每项在 timeout、断线或响应丢失后重试时复用原 key，mock API 捕获并断言两次 HTTP 请求收到相同 `Idempotency-Key`；确定 `COMPLETED`/`FAILED` 后释放，`UNKNOWN` 保留到 reconcile。session 恢复测试仅保存 `batchId` 与未完成 operation keys，重进由管理员手动继续并复用，不保存 token/PII。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/orders/hooks/usePrintBatchRunner.spec.ts src/views/orders/components/OrderTable.spec.ts
```

- [ ] **Step 3：实现不可变 runner**

runner 每次根据服务端 batch view 决定下一动作，不在前端猜计数。使用命名纯函数 `nextBatchAction(view)`；组件只 emit。runner 的不可变 state 为 create、每个 append chunk、seal、每次 process/cancel/queryUnknown/manualResolution/retry 保存各自 UUID，按统一生命周期复用或释放。`beforeRouteLeave/onBeforeUnmount` 警告但不声称撤销已提交任务，并将 `sessionStorage` 收敛为仅含 `batchId` 与未完成 operation keys；重进只提供手动继续，不自动发请求。

- [ ] **Step 4：运行订单模块门禁**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/orders
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
```

- [ ] **Step 5：提交**

```bash
git add apps/admin-web/src/views/orders
git commit -m "feat(admin): run client-driven print batches"
```

### Task 3：新增 Admin 打印批次历史六职责模块

**Files:**

- Create: `apps/admin-web/src/views/printing-batches/PrintingBatchesView.vue`
- Create: `apps/admin-web/src/views/printing-batches/components/PrintBatchTable.vue`
- Create: `apps/admin-web/src/views/printing-batches/components/PrintJobDetail.vue`
- Create: `apps/admin-web/src/views/printing-batches/hooks/usePrintingBatches.ts`
- Create: `apps/admin-web/src/views/printing-batches/hooks/usePrintingBatches.spec.ts`
- Create: `apps/admin-web/src/views/printing-batches/mock/list.mock.ts`
- Create: `apps/admin-web/src/views/printing-batches/config/columns.ts`
- Create: `apps/admin-web/src/views/printing-batches/config/defaults.ts`
- Create: `apps/admin-web/src/views/printing-batches/type/index.ts`
- Create: `apps/admin-web/src/views/printing-batches/api/index.ts`
- Create: `apps/admin-web/src/views/printing-batches/index.ts`
- Modify: `apps/admin-web/src/router/index.ts`
- Modify: `apps/admin-web/src/config/navigation.ts`

- [ ] **Step 0：加载前端项目技能**

执行本 Task 前，必须通过 Skill 调用；CLI 不支持 Skill 时读取项目 skill 加载 `frontend-page-generator` 与 `js-functional-style`；按项目允许方式记录已加载结果。保持既有/新增页面的 `components/hooks/mock/config/type/api` 六职责边界，API 只组合全局 client，runner 与状态转换使用不可变数据和命名纯函数。

- [ ] **Step 1：写 history RED 测试**

覆盖分页、`ACCEPTED` 非物理成功文案、`PAUSED` 继续、`COMPLETED_WITH_ISSUES` 筛选、payload 不展示完整手机号/地址/备注、180 天脱敏状态。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/printing-batches
```

- [ ] **Step 3：实现六职责模块**

路由 `/printing/batches` 需要 PRINT_HISTORY_READ；history API 使用脱敏 view，不直接读取 payload JSON。

- [ ] **Step 4：运行 Admin 全门禁**

```bash
pnpm --filter @bake-mall/admin-web test
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/admin-web build
```

- [ ] **Step 5：提交**

```bash
git add apps/admin-web/src/views/printing-batches apps/admin-web/src/router/index.ts apps/admin-web/src/config/navigation.ts
git commit -m "feat(admin): add cloud print batch history"
```

### Task 4：实现小程序原生订单和单张打印

**Files:**

- Create: `apps/miniapp-shell/admin/api/orders.ts`
- Create: `apps/miniapp-shell/admin/api/printing.ts`
- Create: `apps/miniapp-shell/admin/type/orders.ts`
- Create: `apps/miniapp-shell/admin/type/printing.ts`
- Create: `apps/miniapp-shell/admin/config/orders.ts`
- Create: `apps/miniapp-shell/admin/mock/orders.mock.ts`
- Create: `apps/miniapp-shell/admin/hooks/orders.ts`
- Create: `apps/miniapp-shell/admin/hooks/orders.spec.ts`
- Create: `apps/miniapp-shell/admin/hooks/order-printing.ts`
- Create: `apps/miniapp-shell/admin/hooks/order-printing.spec.ts`
- Create: `apps/miniapp-shell/admin/components/order-list/index.ts`
- Create: `apps/miniapp-shell/admin/components/order-list/index.json`
- Create: `apps/miniapp-shell/admin/components/order-list/index.wxml`
- Create: `apps/miniapp-shell/admin/components/order-list/index.wxss`
- Create: `apps/miniapp-shell/pages/admin-orders/index.{ts,json,wxml,wxss}`
- Create: `apps/miniapp-shell/pages/admin-order-detail/index.{ts,json,wxml,wxss}`
- Modify: `apps/miniapp-shell/app.json`
- Modify: `apps/miniapp-shell/admin/config/navigation.ts`

- [ ] **Step 1：写订单控制器 RED 测试**

覆盖全部订单分页、状态筛选、取消禁打、打印机选择、在线刷新、单张 submit、ACCEPTED/FAILED 与 UNKNOWN 文案、token 401 清 session。单张逻辑操作创建 UUID 并保存到 hook 不可变 state；timeout、断线或响应丢失重试复用原 key，mock API 断言两次 HTTP 请求收到相同 `Idempotency-Key`；确定 `COMPLETED`/`FAILED` 后释放，`UNKNOWN` 保留到 reconcile，再次明确打印使用新 key。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/miniapp-shell test -- admin/hooks/orders.spec.ts admin/hooks/order-printing.spec.ts
```

- [ ] **Step 3：实现原生页面**

页面不复用 H5 DOM；feature API 只能调用 `utils/api-client`，禁止直接 `wx.request`；`order-list` 四件套在 `pages/admin-orders/index.json` 通过 `usingComponents` 注册；组件/控制器职责分开；金额格式纯函数；不把完整地址写日志与 storage。

- [ ] **Step 4：运行小程序门禁**

```bash
pnpm --filter @bake-mall/miniapp-shell verify
```

- [ ] **Step 5：提交**

```bash
git add apps/miniapp-shell/admin apps/miniapp-shell/pages/admin-orders apps/miniapp-shell/pages/admin-order-detail apps/miniapp-shell/app.json
git commit -m "feat(miniapp): print cloud receipts from orders"
```

### Task 5：实现小程序批量打印与人工复核

**Files:**

- Create: `apps/miniapp-shell/admin/hooks/print-batch-runner.ts`
- Create: `apps/miniapp-shell/admin/hooks/print-batch-runner.spec.ts`
- Create: `apps/miniapp-shell/admin/components/print-batch-progress/index.ts`
- Create: `apps/miniapp-shell/admin/components/print-batch-progress/index.json`
- Create: `apps/miniapp-shell/admin/components/print-batch-progress/index.wxml`
- Create: `apps/miniapp-shell/admin/components/print-batch-progress/index.wxss`
- Create: `apps/miniapp-shell/pages/admin-print-batch/index.{ts,json,wxml,wxss}`
- Modify: `apps/miniapp-shell/pages/admin-orders/index.ts`
- Modify: `apps/miniapp-shell/pages/admin-orders/index.wxml`
- Modify: `apps/miniapp-shell/app.json`

- [ ] **Step 1：写中断/手动继续 RED 测试**

覆盖任意数量选择、append100、seal、process循环、部分失败继续、onHide停止、重进不自动继续、管理员点击继续、lease冲突刷新、`UNKNOWN`/`MANUAL_REVIEW` 三类操作、上次printer已解绑清除。对 create、每个 append chunk、seal、每次 process、cancel、queryUnknown、每次 manualResolution、每次 retry 分别创建独立 UUID 并存入 runner 不可变 state；timeout、断线或响应丢失重试复用原 key，mock API 断言两次 HTTP 请求收到相同 `Idempotency-Key`；确定 `COMPLETED`/`FAILED` 后释放，`UNKNOWN` 保留到 reconcile。`onHide/onUnload` 持久化内容严格只有 `batchId` 和未完成 operation keys，不得含 token/PII，重进手动继续时复用。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/miniapp-shell test -- admin/hooks/print-batch-runner.spec.ts
```

- [ ] **Step 3：实现 runner/page**

runner 的副作用方法串行执行，状态每次返回新对象，并按统一生命周期保存各逻辑操作的 UUID key。feature API 只调用 `utils/api-client`；`print-batch-progress` 四件套在 `pages/admin-print-batch/index.json` 通过 `usingComponents` 注册。小程序 `onHide/onUnload` 只停止后续请求，不取消已提交任务；storage 只写 `{ batchId, pendingOperationKeys }`，不得写 token/PII。页面重新加载只展示“继续”按钮；管理员点击后复用持久化的未完成 key，绝不自动生成 key 重放不确定操作。

- [ ] **Step 4：运行全门禁**

```bash
pnpm --filter @bake-mall/miniapp-shell test
pnpm --filter @bake-mall/miniapp-shell typecheck
pnpm --filter @bake-mall/miniapp-shell lint
MINIAPP_H5_URL=https://mall.example.com/ pnpm --filter @bake-mall/miniapp-shell build
```

- [ ] **Step 5：提交**

```bash
git add apps/miniapp-shell
git commit -m "feat(miniapp): run resumable cloud print batches"
```

### Task 6：建立 fake 芯烨云 Playwright 全链路

**Files:**

- Create: `scripts/fake-xpyun-terminal.mjs`
- Create: `scripts/fake-xpyun-terminal.test.mjs`
- Create: `tests/e2e/cloud-printing.spec.ts`
- Modify: `scripts/e2e-runner.mjs`
- Modify: `scripts/e2e-runner.test.mjs`
- Modify: `package.json`

- [ ] **Step 1：先写 runner argv/fake 生命周期和 fake protocol RED 测试**

```js
test('forwards argv and cleans the fake Xpyun process', async () => {
  const result = await runE2e(['cloud-printing.spec.ts']);
  assert.deepEqual(result.forwardedArgv, ['cloud-printing.spec.ts']);
  assert.match(result.xpyunBaseUrl, /^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.equal(result.fakeProcessExited, true);
});

test('binds, verifies and accepts independent print jobs', async () => {
  const result = await runScenario('BATCH_PARTIAL_FAILURE');
  assert.equal(result.accepted, 98);
  assert.equal(result.failed, 1);
  assert.equal(result.unknown, 1);
  assert.equal(result.duplicateVendorJobs, 0);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
node --test scripts/e2e-runner.test.mjs scripts/fake-xpyun-terminal.test.mjs
```

- [ ] **Step 3：实现 E2E 流程**

先修改并测试 `scripts/e2e-runner.mjs`：原样转发 `pnpm test:e2e -- <spec>` 的 argv；监听 `127.0.0.1:0` 启动 fake Xpyun 获取空闲端口；把实际 URL 注入子进程 `XPYUN_BASE_URL`；在 `try/finally` 中终止 fake、等待退出并清理临时资源，即使 Playwright 失败也执行。然后实现 Admin 登录→创建 placeholder→授权 OPERATOR→首次改密→绑定 SN→fake 打印验证码→确认→rename→选择设备→单张→批量→partial failure→UNKNOWN query/manual→取消→解绑→撤权。E2E 不使用真实 secret/SN。

- [ ] **Step 4：运行 E2E**

```bash
node --test scripts/e2e-runner.test.mjs scripts/fake-xpyun-terminal.test.mjs
pnpm test:e2e -- cloud-printing.spec.ts
```

Expected: PASS，无遗留 schema/user/grant，无浏览器 console error。

- [ ] **Step 5：提交**

```bash
git add scripts/fake-xpyun-terminal* scripts/e2e-runner.mjs scripts/e2e-runner.test.mjs tests/e2e/cloud-printing.spec.ts package.json
git commit -m "test(e2e): verify cloud printing operations"
```

### Task 7：编写部署、体验版和门店验收手册

**Files:**

- Create: `docs/runbook/xpyun-registration.md`
- Create: `docs/runbook/cloud-printer-binding.md`
- Create: `docs/runbook/cloud-printing-acceptance.md`
- Modify: `docs/runbook/wechat-miniapp-setup.md`
- Modify: `docs/runbook/deployment.md`
- Modify: `README.md`

- [ ] **Step 1：写不可跳过的验收矩阵**

包含：开放平台注册/user/UserKEY安全、花生壳HTTPS、体验版域名、纸面验证码、在线/离线、单张、再次打印、100张批量、关闭/手动继续、部分失败、UNKNOWN/`MANUAL_REVIEW`、解绑、撤权、PII、180天清理。

- [ ] **Step 2：写部署顺序**

固定：备份MySQL→迁移→API health→Admin/H5→小程序体验版→fake验收→真实凭据→绑定纸面验证码→单张→100张→异常矩阵。真实 secret 不进文档。

- [ ] **Step 3：运行文档格式**

```bash
pnpm exec prettier --check docs/runbook README.md
```

- [ ] **Step 4：提交**

```bash
git add docs/runbook README.md
git commit -m "docs: add xpyun cloud printing runbooks"
```

### Task 8：执行真实芯烨云与小程序体验版验收

**Files:**

- Modify: `docs/runbook/cloud-printing-acceptance.md`（只记录脱敏结果）

- [ ] **Step 1：准备受忽略环境**

在 `.env.development` 配置真实 `XPYUN_USER/XPYUN_USER_KEY`；构建使用花生壳 HTTPS 根 URL 的小程序体验版。确认 git status 不含真实 URL私有配置、AppSecret、UserKEY、SN。

- [ ] **Step 2：完成设备绑定**

输入真实 SN，操作密码二次验证，纸面验证码 5 分钟内确认；测试错误码、错误验证码、过期和重发。

- [ ] **Step 3：完成打印矩阵**

执行单张、已打印再次打印、100张批量、离线阻止、关闭小程序后手动继续、部分失败、timeout、UNKNOWN、`MANUAL_REVIEW` 三类操作、非终态阻止解绑、最终解绑。

- [ ] **Step 4：完成权限矩阵**

SUPER_ADMIN/OPERATOR/普通用户分别验证 Admin Web 和小程序入口；撤权、手机号失验后 token 立即失效；OPERATOR 无法访问商品/会员/导出/upload。

- [ ] **Step 5：记录验收**

只记录版本、时间、脱敏 printer ID、批次计数和结论，不记录完整 SN、手机号、地址、备注与 UserKEY。验收文档必须把第 19.6 节 14 项矩阵逐项标记 `PASS` 并附脱敏证据引用；任何一项缺失、失败、未执行都保持 Task 8 未完成，并禁止 Task 9。

### Task 9：在真实验收后退役 Android/TCP 旧路径

**硬门：** Task 8 全部通过前禁止执行本 Task。

**Files:**

- Delete: `apps/merchant-terminal/`
- Delete: `docs/superpowers/specs/2026-08-02-order-receipt-printing-design.md`
- Delete: `docs/superpowers/plans/2026-08-02-order-receipt-printing-{a-device-poc,b-reliable-backend,c-android-terminal,d-admin-operations-and-acceptance}.md`
- Delete: `docs/runbook/xinye-xp58iih-poc.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/verify-workspace.mjs`
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1：写退役 RED 检查**

先运行全仓 `git status --short` 并保存人工核对结果，再在 `scripts/verify-workspace.mjs` 测试中断言 workspace 不再要求 merchant-terminal，根脚本不再暴露 Android build/package/verify；随后全仓搜索 Android 旧路径引用。硬门再次读取脱敏验收矩阵，逐项确认 14 项均为 `PASS`，否则立即停止且不删除文件。

- [ ] **Step 2：运行并确认 RED**

```bash
git status --short
pnpm verify:workspace
rg -n "merchant-terminal|HBuilderX|verify:android|XP-58IIH|RAW_TCP" . --glob "!.git/**" --glob "!node_modules/**"
```

Expected: 旧引用仍存在。

- [ ] **Step 3：删除旧路径并更新 workspace**

删除文件前再次运行 `git status --short`，并用全仓引用搜索确认没有其他未完成工作依赖目标文件。只删除本规格明确退役内容，保留已迁移到 API 的纯排版测试。更新 lockfile：

```bash
pnpm install --lockfile-only
```

- [ ] **Step 4：运行全仓门禁**

```bash
pnpm verify:workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm format:check
```

Expected: 全部 PASS，无 merchant-terminal workspace 和 Android 工具依赖。

- [ ] **Step 5：提交退役**

```bash
git add -A -- apps/merchant-terminal
git add -u -- docs/superpowers/specs/2026-08-02-order-receipt-printing-design.md docs/superpowers/plans/2026-08-02-order-receipt-printing-a-device-poc.md docs/superpowers/plans/2026-08-02-order-receipt-printing-b-reliable-backend.md docs/superpowers/plans/2026-08-02-order-receipt-printing-c-android-terminal.md docs/superpowers/plans/2026-08-02-order-receipt-printing-d-admin-operations-and-acceptance.md docs/runbook/xinye-xp58iih-poc.md
git add package.json pnpm-lock.yaml scripts/verify-workspace.mjs .gitignore README.md
git diff --cached --name-status
git commit -m "chore: retire android printing path"
```

禁止使用 `git add -A docs`；不得主动 stage `.superpowers/sdd/progress.md`。若该文件已有用户改动，保持 unstaged。提交前缓存区只能包含上方精确列出的退役文件。

### Task 10：最终完成门禁

- [ ] **Step 1：运行所有自动门禁**

```bash
pnpm verify:workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm format:check
pnpm --filter @bake-mall/api migration:run
```

- [ ] **Step 2：确认生产配置**

生产环境模板包含 XPYUN 占位符但无真实 secret；小程序/AppSecret/花生壳私有配置受忽略；Docker API 镜像可构建。

- [ ] **Step 3：最终审查**

只运行一轮完整 code review，重点：权限、secret/PII、幂等、UNKNOWN重复风险、批次无后台消费、retention、旧路径完全退役。

- [ ] **Step 4：完成分支**

调用 `superpowers:finishing-a-development-branch`，根据用户选择提交/PR/合并；不得自动推送。
