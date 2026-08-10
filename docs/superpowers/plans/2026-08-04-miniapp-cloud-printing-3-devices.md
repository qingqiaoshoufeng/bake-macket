# 芯烨云 Adapter 与设备绑定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended); alternatively use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立安全的芯烨云服务端 adapter、通用管理员写操作幂等基础、多打印机持久模型、纸面验证码所有权验证、失败补偿、reconciliation 和双端设备管理；本阶段不开放解绑。

**Architecture:** 所有芯烨云签名与密钥只存在 API adapter。0011 同时建立云打印机与 `admin_operation_idempotency`；绑定和恢复先 claim 通用幂等记录并持久化本地意图，外部调用在事务外完成，再用条件更新推进状态。设备所有权由 5 分钟、最多 5 次的纸面验证码证明；任何 UNKNOWN 进入 ERROR 并通过显式恢复操作收敛。解绑依赖 0012 打印任务实体，本阶段 API 与 UI 明确不开放。

**Tech Stack:** NestJS 11、TypeORM/MySQL、Node fetch、crypto、Vitest、Supertest、Vue 3/Element Plus、原生微信小程序。

**前置：** 前两份计划阶段门通过；已注册芯烨云开发者账号。测试只使用 fake 凭据和 fake server，不要求真实 `UserKEY`。

---

## 文件结构

```text
packages/shared-contracts/src/printing.ts

apps/api/src/printing/
├─ printing.module.ts
├─ xpyun/xpyun.adapter.ts
├─ xpyun/xpyun.adapter.spec.ts
├─ xpyun/xpyun.types.ts
├─ cloud-printer.service.ts
├─ cloud-printer.service.spec.ts
├─ cloud-printer-reconciliation.service.ts
├─ admin-operation-idempotency.service.ts
├─ admin-operation-idempotency.service.spec.ts
├─ admin-cloud-printers.controller.ts
└─ dto/*.ts

apps/api/src/database/
├─ migrations/0011-cloud-printers.ts
├─ entities/cloud-printer.entity.ts
└─ entities/admin-operation-idempotency.entity.ts

apps/admin-web/src/views/printing-devices/{components,hooks,mock,config,type,api}/
apps/miniapp-shell/admin/{components,hooks,mock,config,type,api}/printing-devices*
apps/miniapp-shell/pages/admin-printers/*
```

### Task 1：定义设备绑定共享契约

**Files:**

- Create: `packages/shared-contracts/src/printing.ts`
- Modify: `packages/shared-contracts/src/enums.ts`
- Modify: `packages/shared-contracts/src/errors.ts`
- Modify: `packages/shared-contracts/src/index.ts`
- Create: `packages/shared-contracts/src/printing.spec.ts`
- Create: `packages/shared-contracts/src/printing-contracts.type-test.ts`

- [ ] **Step 1：写状态和敏感字段 RED 测试**

```ts
it('exposes only masked printer identifiers', () => {
  const view: CloudPrinterView = {
    id: '1',
    displayName: '前台',
    serialNumberMasked: 'AB****89',
    status: CloudPrinterStatus.ACTIVE,
    onlineStatus: CloudPrinterOnlineStatus.ONLINE,
    lastStatusCheckedAt: '2026-08-04T00:00:00.000Z',
  };
  expect(JSON.stringify(view)).not.toContain('FULL-SERIAL');
});
```

类型级断言要求 bind request 含 operationPassword；confirm request 含 challengeId/code；所有第 13.5 节设备写 endpoint 通过 HTTP `Idempotency-Key` header 传 key，body DTO 不重复携带 key；响应不能含 hash、UserKEY、完整 SN。类型级测试拒绝状态别名、解绑请求和解绑响应，因为本阶段只交付 bind/verify/status/recovery/rename。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/contracts test -- src/printing.spec.ts
pnpm --filter @bake-mall/contracts typecheck
```

- [ ] **Step 3：实现 enums/DTO/errors**

定义 `CloudPrinterStatus`、`CloudPrinterOnlineStatus`、`VendorRelationState`、`PrinterBindingStage`、绑定/确认/重发/恢复/重命名/列表 DTO，以及无效 SN、归属冲突、验证码错误/过期/耗尽、离线、状态恢复、幂等冲突/处理中/结果未知等错误码。SN 输入统一 `trim` 后校验 `/^[A-Za-z0-9-]{1,64}$/u`，保持原大小写，不执行 uppercase。重命名 `displayName` trim 后长度 1–64，要求 `PRINT_DEVICE_MANAGE`，不要求密码二次验证。

- [ ] **Step 4：运行 contracts 门禁**

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/contracts build
pnpm --filter @bake-mall/contracts lint
```

- [ ] **Step 5：提交**

```bash
git add packages/shared-contracts/src
git commit -m "feat(contracts): add cloud printer binding contracts"
```

### Task 2：加入芯烨云生产配置和签名 adapter

**Files:**

- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/env.schema.spec.ts`
- Modify: `.env.development.example`
- Modify: `.env.production.example`
- Create: `apps/api/src/printing/xpyun/xpyun.types.ts`
- Create: `apps/api/src/printing/xpyun/xpyun.adapter.ts`
- Create: `apps/api/src/printing/xpyun/xpyun.adapter.spec.ts`
- Create: `apps/api/test/fakes/fake-xpyun-server.ts`
- Create: `apps/api/test/fakes/fake-xpyun-server.spec.ts`

- [ ] **Step 1：写 env、签名、timeout 和 schema RED 测试**

```ts
it('signs without exposing UserKEY in the request body', async () => {
  await adapter.addPrinter({ serialNumber: 'SN123', name: '前台' });
  const request = fake.lastRequest();
  expect(request.body).toMatchObject({ user: 'developer', sn: 'SN123' });
  expect(JSON.stringify(request.body)).not.toContain('top-secret-key');
  expect(request.body.sign).toMatch(/^[a-f0-9]{40}$/u);
});
```

覆盖 production 必需字段、固定 HTTPS base URL/测试可覆盖、10 位 timestamp、SHA1 官方签名顺序、超时 UNKNOWN、非 JSON、错误码映射、安全日志。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/xpyun/xpyun.adapter.spec.ts test/fakes/fake-xpyun-server.spec.ts
```

- [ ] **Step 3：实现 adapter**

`AppEnv` 增加 `XPYUN_USER/XPYUN_USER_KEY/XPYUN_BASE_URL/XPYUN_TIMEOUT_MS`；生产必需且禁止 fallback secret。adapter 方法固定为 add/delete/queryOnline/print/queryOrder。统一使用 `AbortSignal.timeout`；响应做 unknown→typed parser，日志只保留 operation、耗时、厂商 code、脱敏 SN。

- [ ] **Step 4：运行测试**

```bash
pnpm --filter @bake-mall/api test -- src/printing/xpyun test/fakes/fake-xpyun-server.spec.ts src/config
pnpm --filter @bake-mall/api typecheck
```

- [ ] **Step 5：提交**

```bash
git add apps/api/src/config apps/api/src/printing/xpyun apps/api/test/fakes .env.development.example .env.production.example
git commit -m "feat(api): add xpyun cloud adapter"
```

### Task 3：创建云打印机 schema 和实体

**Files:**

- Create: `apps/api/src/database/migrations/0011-cloud-printers.ts`
- Create: `apps/api/src/database/migrations/0011-cloud-printers.spec.ts`
- Create: `apps/api/test/0011-cloud-printers.e2e-spec.ts`
- Modify: `apps/api/src/database/migrations/index.ts`
- Modify: `apps/api/src/database/migrations/index.spec.ts`
- Create: `apps/api/src/database/entities/cloud-printer.entity.ts`
- Create: `apps/api/src/database/entities/admin-operation-idempotency.entity.ts`
- Modify: `apps/api/src/database/entities/index.ts`
- Create: `apps/api/src/database/entities/cloud-printer.entity.spec.ts`
- Create: `apps/api/src/database/entities/admin-operation-idempotency.entity.spec.ts`
- Create: `apps/api/src/printing/admin-operation-idempotency.service.ts`
- Create: `apps/api/src/printing/admin-operation-idempotency.service.spec.ts`

- [ ] **Step 1：写迁移 RED 测试**

断言 `cloud_printers.serial_number varchar(64)`、SN 唯一索引、完整状态 enum、vendor relation、binding stage、验证码 hash/expiry/attempts、在线缓存、admin FK、version、UTC 时间；不得存 UserKEY。

断言 0011 同时创建 `admin_operation_idempotency`：`admin_id`、`operation`、`key`、`request_hash char(64)`、`status enum('IN_PROGRESS','COMPLETED','FAILED','UNKNOWN')`、nullable `resource_type/resource_id/response_snapshot`、UTC `created_at/updated_at`，并具有 `UNIQUE(admin_id, operation, key)`。`down` 只要 `cloud_printers`、`admin_operation_idempotency` 任一表存在域数据就抛错并保持 schema 不变；两表均无域数据才删除 0011 创建的表。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/0011-cloud-printers.spec.ts
```

- [ ] **Step 3：实现迁移和实体**

SN 固定 `varchar(64)`；输入 trim 后仅接受 1–64 个 ASCII 字母、数字和连字符并保持大小写，API 永不返回完整 SN。`UNBOUND -> BINDING` 可重绑，历史记录不删除。

实现 `AdminOperationIdempotencyService`：以 admin ID + operation + key claim；canonical request 计算 SHA-256。相同 key/operation/admin 且 hash 相同：`COMPLETED`/`FAILED` 返回同一稳定快照，`IN_PROGRESS` 返回处理中，`UNKNOWN` 进入显式 reconcile；hash 不同返回冲突。唯一键与条件更新保证并发只有一个 owner。外部成功但本地完成写入中断时保留 `UNKNOWN`，由 operation-specific reconcile 查询本地资源与 vendor 状态后写 `COMPLETED`/`FAILED`，不得重放外部调用。response snapshot 不含密码、完整 SN、credential、token。将迁移追加到统一列表，注册表期望同步为 11 项且尾项为 0011。

- [ ] **Step 4：运行迁移门禁**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/0011-cloud-printers.spec.ts src/database/entities/cloud-printer.entity.spec.ts src/database/entities/admin-operation-idempotency.entity.spec.ts src/printing/admin-operation-idempotency.service.spec.ts src/database/migrations/index.spec.ts
pnpm --filter @bake-mall/api test:e2e -- 0011-cloud-printers.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api migration:run
```

- [ ] **Step 5：提交**

```bash
git add apps/api/src/database apps/api/src/printing/admin-operation-idempotency.service.ts apps/api/src/printing/admin-operation-idempotency.service.spec.ts
git commit -m "feat(api): add cloud printer schema and admin operation idempotency"
```

### Task 4：实现 BINDING、纸面验证码和补偿状态机

**Files:**

- Create: `apps/api/src/printing/printing.module.ts`
- Create: `apps/api/src/printing/cloud-printer.service.ts`
- Create: `apps/api/src/printing/cloud-printer.service.spec.ts`
- Create: `apps/api/src/printing/admin-cloud-printers.controller.ts`
- Create: `apps/api/src/printing/dto/bind-cloud-printer.dto.ts`
- Create: `apps/api/src/printing/dto/confirm-printer-code.dto.ts`
- Create: `apps/api/src/printing/dto/recover-cloud-printer.dto.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/cloud-printer-binding-mysql.e2e-spec.ts`
- Create: `apps/api/test/cloud-printers.e2e-spec.ts`

- [ ] **Step 1：写状态机 RED 单测**

逐项覆盖发起绑定、提交验证码、重发验证码：缺少 `Idempotency-Key` 拒绝；同 key 同 hash replay 同一资源/响应且不重复 vendor；同 key 不同 hash conflict；并发只有一个 owner；外部完成后本地中断转 UNKNOWN 并由 reconcile 收敛。状态机覆盖先提交 BINDING 再 add；add 成功生成 hash challenge；验证码打印明确成功→PENDING_VERIFICATION；明确失败→del 补偿→UNBOUND；发送/删除 UNKNOWN→ERROR；5 分钟、5 次；过期重发复用同记录不 del；add 已存在必须证明本地归属。绑定与验证码操作二次验证；重命名不二次验证。

```ts
expect(callTrace).toEqual([
  'db:BINDING',
  'vendor:add',
  'db:challenge',
  'vendor:print-code',
  'db:PENDING_VERIFICATION',
]);
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/cloud-printer.service.spec.ts
```

- [ ] **Step 3：实现短事务状态推进**

所有写 endpoint 从 header 读取 `Idempotency-Key` 并调用 `AdminOperationIdempotencyService`；外部调用前后各短事务，以 request hash/expected version 条件推进。验证码使用 crypto 随机数，bcrypt/hash 后入库，明文只传一次 adapter。controller 要求 `PRINT_DEVICE_MANAGE`；响应脱敏 SN。新增 rename endpoint：displayName trim 后 1–64，复用通用幂等 service，不要求 operation password；成功与拒绝审计只记录 ADMIN actor、action、printer internal ID、结果/状态，不含完整 SN、密码、验证码。业务事务回滚时成功审计一并回滚，外部调用后的 FAILED 与 UNKNOWN 只写真实结果，绝不伪造 success。

- [ ] **Step 4：运行 HTTP 与真实 MySQL**

```bash
pnpm --filter @bake-mall/api test -- src/printing/cloud-printer.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- cloud-printers.e2e-spec.ts cloud-printer-binding-mysql.e2e-spec.ts
```

覆盖同 SN 并发、挑战并发、rename 长度/permission/审计、每种写操作幂等、崩溃注入、rollback 无虚假成功审计、随机 schema 清理。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/src/app.module.ts apps/api/test/cloud-printer*
git commit -m "feat(api): bind cloud printers with paper verification"
```

### Task 5：实现在线状态与绑定 reconciliation

**Files:**

- Create: `apps/api/src/printing/cloud-printer-reconciliation.service.ts`
- Create: `apps/api/src/printing/cloud-printer-reconciliation.service.spec.ts`
- Modify: `apps/api/src/printing/cloud-printer.service.ts`
- Modify: `apps/api/src/printing/admin-cloud-printers.controller.ts`
- Create: `apps/api/test/cloud-printer-recovery-mysql.e2e-spec.ts`
- Modify: `apps/api/src/printing/admin-operation-idempotency.service.ts`
- Modify: `apps/api/src/printing/admin-operation-idempotency.service.spec.ts`

- [ ] **Step 1：写恢复与状态查询 RED 测试**

覆盖 30 秒在线缓存、查询失败 fail closed、BINDING/ERROR 重新查询、重发挑战、补偿流程确认删除、UNKNOWN 保持不可用、补偿删除明确成功后 UNBOUND。逐项覆盖重新查询厂商关联、确认补偿删除：`Idempotency-Key` 必填、同 key 同 hash replay、不同 hash conflict、并发 owner、外部完成/本地中断转 UNKNOWN 后 reconcile。permission 拒绝与 recovery 审计逐项断言 ADMIN actor、action、printer target、无 PII/完整 SN，事务回滚无虚假 success。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/cloud-printer-reconciliation.service.spec.ts
```

- [ ] **Step 3：实现恢复 service**

reconciliation 只处理设备绑定与补偿阶段，不读取/提交打印 job。管理员触发和计划任务复用同一方法；计划任务使用固定上限 batch 和条件锁。管理员恢复写 endpoint 统一复用 `AdminOperationIdempotencyService`，外部调用事务外，UNKNOWN 由同一 operation reconcile 收敛。

本阶段不定义解绑 DTO、controller、service 方法与 repository 抽象，也不声称解绑可用；真正解绑在第四份计划 Task 8，待 0012 print batch/job schema 已存在后通过真实 repository 门禁实现。

- [ ] **Step 4：运行恢复矩阵**

```bash
pnpm --filter @bake-mall/api test -- src/printing
pnpm --filter @bake-mall/api test:e2e -- cloud-printer-recovery-mysql.e2e-spec.ts cloud-printer-binding-mysql.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
```

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/test/cloud-printer-recovery-mysql.e2e-spec.ts
git commit -m "feat(api): reconcile cloud printer bindings"
```

### Task 6：Admin Web 打印机管理六职责模块

**Files:**

- Create: `apps/admin-web/src/views/printing-devices/PrintingDevicesView.vue`
- Create: `apps/admin-web/src/views/printing-devices/components/PrinterTable.vue`
- Create: `apps/admin-web/src/views/printing-devices/components/BindPrinterDialog.vue`
- Create: `apps/admin-web/src/views/printing-devices/components/VerifyPrinterDialog.vue`
- Create: `apps/admin-web/src/views/printing-devices/components/PrinterRecoveryActions.vue`
- Create: `apps/admin-web/src/views/printing-devices/components/RenamePrinterDialog.vue`
- Create: `apps/admin-web/src/views/printing-devices/hooks/usePrintingDevices.ts`
- Create: `apps/admin-web/src/views/printing-devices/hooks/usePrintingDevices.spec.ts`
- Create: `apps/admin-web/src/views/printing-devices/mock/devices.mock.ts`
- Create: `apps/admin-web/src/views/printing-devices/config/columns.ts`
- Create: `apps/admin-web/src/views/printing-devices/config/defaults.ts`
- Create: `apps/admin-web/src/views/printing-devices/type/index.ts`
- Create: `apps/admin-web/src/views/printing-devices/api/index.ts`
- Create: `apps/admin-web/src/views/printing-devices/index.ts`
- Modify: `apps/admin-web/src/router/index.ts`
- Modify: `apps/admin-web/src/config/navigation.ts`

- [ ] **Step 0：加载前端项目技能**

执行本 Task 前，必须通过 Skill 调用；CLI 不支持 Skill 时读取项目 skill 加载 `frontend-page-generator` 与 `js-functional-style`；按项目允许方式记录已加载结果。保持 `components/hooks/mock/config/type/api` 六职责完整，API 只组合全局 client，hook 使用不可变状态与命名纯函数。

- [ ] **Step 1：写绑定向导 RED 测试**

覆盖 operation password 立即清除、5 分钟倒计时、剩余次数、stale request、SN 只脱敏、状态对应恢复 action、rename trim/1–64/无密码二次验证。对 bind、confirm、resend、重新查询厂商关联（requery）、确认补偿删除（delete-confirm）、rename 逐项断言：每个用户触发的逻辑操作创建一个 UUID `Idempotency-Key` 并保存到 hook/runner 的不可变 operation state；因 timeout、断线或响应丢失重试时复用原 key，mock API 连续两次实际收到相同 header key；只有收到确定的 `COMPLETED` 或 `FAILED` 稳定响应才释放 key，`UNKNOWN` 必须保留原 key 直到对应 reconcile 收敛。再次明确发起同类操作属于新逻辑操作并生成新 UUID。虽然规格 13.5 未强制 rename，rename 仍统一携带 key 以保持设备写操作一致。设备行显示禁用的“解绑”按钮和固定说明“将在打印任务基础完成后开放”，不得调用不存在的解绑 API。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/printing-devices
```

- [ ] **Step 3：实现六职责页面**

API 只拼路径并为 bind/confirm/resend/requery/delete-confirm/rename 传 `Idempotency-Key`。hook 用不可变 operation state 保存“逻辑操作 → UUID key → 当前稳定性状态”，timeout、断线和响应丢失重试不得重新生成 key；确定 `COMPLETED`/`FAILED` 后释放，`UNKNOWN` 保留到 reconcile。Admin `sessionStorage` 只持久化 `{ adminId, pendingDeviceOperations: [{ operation, resourceId?, idempotencyKey }] }` 以支持刷新后手动继续，不得保存 token、SN、密码或其他 PII；恢复时复用原 key，退出登录或操作稳定收敛后清除。组件无 fetch。路由 `/printing/devices` 需要 PRINT_DEVICE_MANAGE。列表不缓存完整 SN；表单提交后清除 SN 和密码。rename 不显示密码字段。解绑控件不可点击并显示“将在打印任务基础完成后开放”。

- [ ] **Step 4：运行门禁**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/printing-devices src/router/index.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/admin-web build
```

- [ ] **Step 5：提交**

```bash
git add apps/admin-web/src/views/printing-devices apps/admin-web/src/router/index.ts apps/admin-web/src/config/navigation.ts
git commit -m "feat(admin): manage cloud printers"
```

### Task 7：小程序打印机管理模块

**Files:**

- Create: `apps/miniapp-shell/admin/api/printing-devices.ts`
- Create: `apps/miniapp-shell/admin/type/printing-devices.ts`
- Create: `apps/miniapp-shell/admin/config/printing-devices.ts`
- Create: `apps/miniapp-shell/admin/mock/printing-devices.mock.ts`
- Create: `apps/miniapp-shell/admin/hooks/printing-devices.ts`
- Create: `apps/miniapp-shell/admin/hooks/printing-devices.spec.ts`
- Create: `apps/miniapp-shell/admin/components/printer-list/index.ts`
- Create: `apps/miniapp-shell/admin/components/printer-list/index.json`
- Create: `apps/miniapp-shell/admin/components/printer-list/index.wxml`
- Create: `apps/miniapp-shell/admin/components/printer-list/index.wxss`
- Create: `apps/miniapp-shell/pages/admin-printers/index.{ts,json,wxml,wxss}`
- Modify: `apps/miniapp-shell/app.json`
- Modify: `apps/miniapp-shell/admin/config/navigation.ts`

- [ ] **Step 1：写原生控制器 RED 测试**

覆盖 bind→倒计时→confirm、5 次失败、ERROR 恢复、离线状态、rename。对 bind、confirm、resend、requery、delete-confirm、rename 每个逻辑操作分别创建 UUID 并存入不可变 state；timeout、断线或响应丢失后重试必须复用原 `Idempotency-Key`，mock API 断言两次请求实际收到相同 header key；确定 `COMPLETED`/`FAILED` 后释放，`UNKNOWN` 保留至 reconcile，用户再次明确发起操作才创建新 key。operation password 不进 storage、上次打印机选择只存 printer ID。解绑固定显示“将在打印任务基础完成后开放”且不可点击，不调用 API。静态边界测试证明 feature API 只调用 `utils/api-client`，admin 目录无直接 `wx.request`。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/miniapp-shell test -- admin/hooks/printing-devices.spec.ts
```

- [ ] **Step 3：实现原生页面**

遵循六职责适配；`printer-list` 为四件套组件目录并在 `pages/admin-printers/index.json` 的 `usingComponents` 注册；页面 setData 使用新对象；feature API 只调用 `utils/api-client`。wx storage 仅可保存 `{ adminId, lastPrinterId, pendingDeviceOperations: [{ operation, resourceId?, idempotencyKey }] }`；页面 `onHide/onUnload` 只持久化尚未稳定收敛的 operation keys，重进后显示手动继续并复用原 key，不自动重放。不得保存 SN、密码、UserKEY、admin token 或其他 PII；确定 `COMPLETED`/`FAILED` 后删除对应 key，`UNKNOWN` 保留到 reconcile。rename trim 后 1–64 且不收密码；解绑按钮保持禁用说明。

- [ ] **Step 4：运行小程序门禁**

```bash
pnpm --filter @bake-mall/miniapp-shell verify
```

- [ ] **Step 5：提交**

```bash
git add apps/miniapp-shell/admin apps/miniapp-shell/pages/admin-printers apps/miniapp-shell/app.json
git commit -m "feat(miniapp): manage cloud printers"
```

### Task 8：阶段三完整验证

- [ ] **Step 1：运行后端门禁**

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/api test
pnpm --filter @bake-mall/api test:e2e -- cloud-printers.e2e-spec.ts cloud-printer-binding-mysql.e2e-spec.ts cloud-printer-recovery-mysql.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api lint
pnpm --filter @bake-mall/api build
```

- [ ] **Step 2：运行双前端**

```bash
pnpm --filter @bake-mall/admin-web test
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/miniapp-shell verify
```

- [ ] **Step 3：安全扫描**

```bash
rg -n "XPYUN_USER_KEY|serialNumber" apps/admin-web apps/miniapp-shell packages/shared-contracts
pnpm exec prettier --check packages/shared-contracts/src apps/api/src apps/api/test apps/admin-web/src apps/miniapp-shell
git diff --check
```

Expected: 客户端无 UserKEY；完整 SN 只存在服务端请求/实体，view 全脱敏。

- [ ] **Step 4：审查与 fake 运行时验收**

运行设备状态机/secret 专项 review；启动 fake Xpyun server，实际经 HTTP 验证 add、验证码打印、confirm、offline、rename、补偿 del、幂等 replay/conflict/concurrent owner 和 UNKNOWN reconcile；阶段验收不测试解绑。

- [ ] **Step 5：提交阶段收口**

```bash
git add packages/shared-contracts apps/api apps/admin-web apps/miniapp-shell .env.*example
git commit -m "feat: complete cloud printer binding"
```
