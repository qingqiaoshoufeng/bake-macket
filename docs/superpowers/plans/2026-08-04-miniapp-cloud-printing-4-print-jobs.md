# 服务端小票与打印任务状态机 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended); alternatively use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用订单不可变快照构造脱敏小票，交付幂等单张打印、纯客户端拉动批次、厂商 UNKNOWN 人工收敛和 180 天 PII 清理。

**Architecture:** 所有第 13.5 节打印写操作先复用 0011 `AdminOperationIdempotencyService` claim，再持久化资源和调用事务外厂商。单张打印也原子创建一个 `READY` 的一项 batch 与非空 `batch_id` job，随后调用与批量相同的 process service；幂等重放复用原 batch/job。批次由客户端每次 process 最多 20 项并持有 60 秒租约；UNKNOWN 只能查询后人工收敛，不能自动重发。

**Tech Stack:** NestJS 11、TypeORM/MySQL、Vitest、Supertest、`iconv-lite`、纯文本清理、crypto SHA-256、芯烨云 adapter。

**前置：** 前三份计划阶段门通过。

**后端幂等测试矩阵（本计划硬约束）：** 单张打印、batch create、每个 append chunk、seal、每次 process、cancel、queryUnknown、每次 manualResolution、FAILED retry 与重复风险 retry 的 key 都由 HTTP `Idempotency-Key` header 传入，body DTO 不携带 key。controller/e2e 测试逐操作断言 header 缺失即拒绝，并用相同 key + 相同 canonical request hash 重放，验证返回同一稳定 response snapshot/resource 且不重复创建资源、不重复调用厂商；再用相同 key + 不同 canonical request hash 验证返回 idempotency conflict。service 测试同时覆盖 `COMPLETED`/`FAILED` replay、`IN_PROGRESS`、`UNKNOWN` reconcile 和并发唯一 owner；每个 append chunk、每次 process/manualResolution/retry 都是独立逻辑操作，使用独立 key。

---

## 文件结构

```text
packages/shared-contracts/src/printing.ts

apps/api/src/database/
├─ migrations/0012-cloud-print-jobs.ts
├─ entities/print-batch.entity.ts
└─ entities/print-job.entity.ts

apps/api/src/printing/
├─ receipt/display-width.ts
├─ receipt/text-layout.ts
├─ receipt/receipt-payload.ts
├─ receipt/xpyun-receipt-renderer.ts
├─ payload-hash.ts
├─ print-job.service.ts
├─ print-batch.service.ts
├─ print-recovery.service.ts
├─ print-retention.service.ts
├─ admin-print-jobs.controller.ts
├─ run-print-retention.ts
└─ dto/*.ts

apps/api/test/
├─ cloud-print-jobs-mysql.e2e-spec.ts
├─ cloud-print-batches-mysql.e2e-spec.ts
└─ cloud-print-recovery-mysql.e2e-spec.ts
```

### Task 1：扩展打印 job/batch 共享契约

**Files:**

- Modify: `packages/shared-contracts/src/printing.ts`
- Modify: `packages/shared-contracts/src/enums.ts`
- Modify: `packages/shared-contracts/src/errors.ts`
- Modify: `packages/shared-contracts/src/printing.spec.ts`
- Modify: `packages/shared-contracts/src/printing-contracts.type-test.ts`

- [ ] **Step 1：写状态机和可辨识联合 RED 测试**

```ts
expect(canTransitionPrintBatch('DRAFT', 'READY')).toBe(true);
expect(canTransitionPrintBatch('RUNNING', 'COMPLETED')).toBe(true);
expect(canTransitionPrintJob('UNKNOWN', 'MANUAL_REVIEW')).toBe(true);
expect(canTransitionPrintJob('UNKNOWN', 'PENDING')).toBe(false);
```

类型级断言：人工确认三种 request 可辨识；批次 process response 使用 accepted/failed/unknown/manualReview，不使用 success；CreatePrintBatch 不接受客户端 payload/金额。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/contracts test -- src/printing.spec.ts
pnpm --filter @bake-mall/contracts typecheck
```

- [ ] **Step 3：实现状态、DTO 和错误码**

定义完整 `PrintBatchStatus`：`DRAFT | READY | RUNNING | PAUSED | COMPLETED | COMPLETED_WITH_ISSUES | CANCELLED`；完整 `PrintJobStatus`：`PENDING | SUBMITTING | ACCEPTED | FAILED | UNKNOWN | MANUAL_REVIEW | MANUALLY_CONFIRMED_PRINTED | MANUALLY_CLOSED | CANCELLED`；定义 `ManualPrintResolution`、batch/job views、单张/append/seal/process/cancel/query/retry/manual request。每个写 endpoint 的文档和 client contract 明确 HTTP `Idempotency-Key` 必填：单张、create、append、seal、process、cancel、query UNKNOWN、manual resolve、FAILED retry/重复风险 retry。`ACCEPTED` 文档明确“厂商接受，不代表物理出纸”。类型测试逐个拒绝缺失 header 的 client helper 签名、`ISSUES`、`CLOSED`、`MANUAL` 状态别名和非完整枚举值。

- [ ] **Step 4：运行 contracts 全门禁**

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/contracts build
pnpm --filter @bake-mall/contracts lint
```

- [ ] **Step 5：提交**

```bash
git add packages/shared-contracts/src
git commit -m "feat(contracts): add cloud print job contracts"
```

### Task 2：创建打印批次与任务 schema

**Files:**

- Create: `apps/api/src/database/migrations/0012-cloud-print-jobs.ts`
- Create: `apps/api/src/database/migrations/0012-cloud-print-jobs.spec.ts`
- Modify: `apps/api/src/database/migrations/index.ts`
- Modify: `apps/api/src/database/migrations/index.spec.ts`
- Create: `apps/api/src/database/entities/print-batch.entity.ts`
- Create: `apps/api/src/database/entities/print-job.entity.ts`
- Modify: `apps/api/src/database/entities/index.ts`
- Create: `apps/api/src/database/entities/cloud-print-job-entities.spec.ts`

- [ ] **Step 1：写迁移 RED 测试**

断言 batch/job 字段和完整 enum、`print_jobs.batch_id BIGINT UNSIGNED NOT NULL`、`UNIQUE(batch_id, order_id)`（同一批次去重）、`UNIQUE(order_id, sequence)`、printer/order/admin FK、lease/queue 索引、payload JSON/hash、vendor id/error、manual resolution/supersedes、UTC 时间。业务幂等统一使用 0011 `admin_operation_idempotency`，0012 不再创建 `print_jobs.idempotency_key`。金额不重复用浮点字段。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/0012-cloud-print-jobs.spec.ts
```

- [ ] **Step 3：实现迁移和实体**

批次持久计数遵循规格不变量；`manual_review_count` 不计 classified。0012 `down` 只要 `print_batches`、`print_jobs` 任一表存在域数据就抛错并保持 schema 不变，两表均无域数据才 drop。追加统一迁移列表，注册表期望同步为 12 项且尾项为 0012。

- [ ] **Step 4：运行迁移门禁**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/0012-cloud-print-jobs.spec.ts src/database/entities/cloud-print-job-entities.spec.ts src/database/migrations/index.spec.ts
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api migration:run
```

- [ ] **Step 5：提交**

```bash
git add apps/api/src/database
git commit -m "feat(api): add cloud print job schema"
```

### Task 3：迁移并实现服务端 58mm 小票纯函数

**Files:**

- Create: `apps/api/src/printing/receipt/display-width.ts`
- Create: `apps/api/src/printing/receipt/text-layout.ts`
- Create: `apps/api/src/printing/receipt/receipt-payload.ts`
- Create: `apps/api/src/printing/receipt/receipt-payload.spec.ts`
- Create: `apps/api/src/printing/receipt/xpyun-receipt-renderer.ts`
- Create: `apps/api/src/printing/receipt/xpyun-receipt-renderer.spec.ts`
- Create: `apps/api/src/printing/payload-hash.ts`
- Create: `apps/api/src/printing/payload-hash.spec.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Reference only: `apps/merchant-terminal/src/receipt/*.ts`

- [ ] **Step 1：写快照、脱敏与控制字符 RED 测试**

```ts
expect(payload.customer.phoneMasked).toBe('138****0000');
expect(payload.fulfillment).toEqual({
  type: 'DELIVERY',
  addressText: order.deliveryAddressText,
});
expect(rendered).not.toContain('');
expect(rendered).toContain('应付金额 89.20');
expect(hashPrintPayload(payload)).toBe(
  hashPrintPayload(structuredClone(payload)),
);
```

覆盖 pickup 无地址、备注换行、整数分、会员优惠/credit、再次打印次数、实时 Product/Sku 修改不影响快照、日志摘要无地址/备注。新增 GBK 字节测试：使用 `iconv-lite.encode(rendered, 'gbk')` 后严格 `<= 12 * 1024`；订单号和所有金额行不可截断；超限时按固定顺序先截断备注、再截断地址，每个被截断字段追加确定标记 `[已截断]`；仍超限则返回确定性 payload-too-large 错误，不截断订单号与金额。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/receipt src/printing/payload-hash.spec.ts
```

- [ ] **Step 3：实现纯 builder/renderer/hash**

从旧 PoC 只迁移 `displayWidth/sanitizePrintableText/wrapByDisplayWidth` 思路，不复制 Android capability/TCP。renderer 固定输出纯文本，不使用任何厂商 markup。API 增加 direct dependency `iconv-lite`；渲染后按 GBK 编码字节严格校验 `<= 12 KiB`。确定性降级顺序为备注后地址，各字段按 display width 有界截断并追加 `[已截断]`；订单号、商品金额、商品合计、优惠、credit 与应付金额不可截断。降级后仍超限则拒绝提交。

- [ ] **Step 4：运行测试和类型检查**

```bash
pnpm --filter @bake-mall/api test -- src/printing/receipt src/printing/payload-hash.spec.ts
pnpm --filter @bake-mall/api typecheck
```

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing/receipt apps/api/src/printing/payload-hash* apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): render immutable cloud receipts"
```

### Task 4：实现幂等单张打印

**Files:**

- Create: `apps/api/src/printing/print-job.service.ts`
- Create: `apps/api/src/printing/print-job.service.spec.ts`
- Create: `apps/api/src/printing/admin-print-jobs.controller.ts`
- Create: `apps/api/src/printing/dto/create-print-job.dto.ts`
- Modify: `apps/api/src/printing/printing.module.ts`
- Create: `apps/api/test/cloud-print-jobs-mysql.e2e-spec.ts`
- Create: `apps/api/test/cloud-print-jobs.e2e-spec.ts`

- [ ] **Step 1：写 PENDING→SUBMITTING→分类 RED 测试**

覆盖设备 ACTIVE+30 秒在线、订单非 CANCELLED；controller 从 HTTP `Idempotency-Key` header 取 key且缺失拒绝，body 不携带 key。同 key 同 canonical request hash replay 必须返回相同 response snapshot 和同一 batch/job，且不新建 sequence、不重复调用 vendor；同 key 不同 canonical request hash 返回 conflict；并发只有一个 owner；外部完成/本地中断进入 UNKNOWN 并 reconcile。首次请求原子创建 `READY` 一项 batch 和 `batch_id NOT NULL` 的 PENDING job，随后调用与批量相同的 process service。再次明确点击使用新 key 创建新 batch/job 且 sequence++；UNKNOWN 不自动重试。

```ts
expect(trace).toEqual([
  'db:batch:READY+job:PENDING',
  'service:process',
  'db:SUBMITTING',
  'vendor:print',
  'db:ACCEPTED',
]);
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-job.service.spec.ts
```

- [ ] **Step 3：实现 service/controller**

controller 要求 PRINT_EXECUTE 和 `Idempotency-Key`。先调用 `AdminOperationIdempotencyService` claim `PRINT_SINGLE_CREATE`，再从 Order/OrderItem 构造 payload并在同一事务创建 `READY` 一项 batch + PENDING job；随后调用统一 process service。vendor id 和结果分类入库。审计矩阵断言 ADMIN actor、`PRINT_SINGLE_CREATE/PROCESS` action、batch/job/order/printer internal target、状态结果且无 PII；permission 拒绝单独写真实拒绝审计。事务回滚不得留下 success 审计，外部 UNKNOWN 不得伪造成 ACCEPTED。

- [ ] **Step 4：运行 HTTP/真实 MySQL**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-job.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- cloud-print-jobs.e2e-spec.ts cloud-print-jobs-mysql.e2e-spec.ts
```

覆盖并发相同 key、订单取消竞态、设备解绑竞态和崩溃注入。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/test/cloud-print-jobs*
git commit -m "feat(api): submit idempotent cloud print jobs"
```

### Task 5：实现 DRAFT/append/seal 的批次基础

**Files:**

- Create: `apps/api/src/printing/print-batch.service.ts`
- Create: `apps/api/src/printing/print-batch.service.spec.ts`
- Create: `apps/api/src/printing/dto/create-print-batch.dto.ts`
- Create: `apps/api/src/printing/dto/append-print-batch.dto.ts`
- Create: `apps/api/src/printing/dto/seal-print-batch.dto.ts`
- Modify: `apps/api/src/printing/admin-print-jobs.controller.ts`
- Create: `apps/api/test/cloud-print-batches-mysql.e2e-spec.ts`

- [ ] **Step 1：写批次构建 RED 测试**

对 create、每个 append chunk、seal 逐项覆盖：key 只从 HTTP `Idempotency-Key` header 读取，缺失拒绝且 body 不携带；相同 key + 相同 canonical request hash replay 相同稳定 response snapshot/resource，不重复 append/job 创建；相同 key + 不同 canonical request hash 返回 conflict；并发一个 owner；`COMPLETED`/`FAILED` 稳定 replay 与 `UNKNOWN` reconcile。每个 append chunk 是独立逻辑操作并使用独立 key。业务覆盖 DRAFT only append、每次 append 最大 100 个 order IDs（传输上限，不是产品总量上限）、去重、取消订单拒绝、seal 后禁止 append、payload 在 append 时创建、batch_id 非空、批次固定 printer、计数不变量。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-batch.service.spec.ts
```

- [ ] **Step 3：实现 create/append/seal**

create/append/seal 分别使用 operation 常量并复用 `AdminOperationIdempotencyService`。append 使用事务锁 batch，按 order ID 稳定排序读取快照；任何非法订单使当前 append chunk 原子失败，但不撤销先前成功 chunk。seal 要求 total>0，`DRAFT -> READY` 条件更新。每项审计记录 ADMIN actor、action、batch target、计数/状态且无 payload PII；回滚无虚假 success。

- [ ] **Step 4：运行测试**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-batch.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- cloud-print-batches-mysql.e2e-spec.ts
```

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/test/cloud-print-batches-mysql.e2e-spec.ts
git commit -m "feat(api): create sealable print batches"
```

### Task 6：实现 20 项 process 与 60 秒 lease

**Files:**

- Modify: `apps/api/src/printing/print-batch.service.ts`
- Modify: `apps/api/src/printing/print-batch.service.spec.ts`
- Create: `apps/api/src/printing/dto/process-print-batch.dto.ts`
- Modify: `apps/api/src/printing/admin-print-jobs.controller.ts`
- Modify: `apps/api/test/cloud-print-batches-mysql.e2e-spec.ts`

- [ ] **Step 1：写客户端拉动 RED 测试**

覆盖每一次 process 使用独立 key，且 key 只从 HTTP `Idempotency-Key` header 读取，缺失拒绝；相同 key + 相同 canonical request hash replay 相同稳定 response snapshot/lease 结果且不重复 vendor call，相同 key + 不同 canonical request hash 返回 conflict；唯一 lease、并发 process 只有一个、每次最多20、单项 FAILED继续、页面不调用则无消费、请求后剩余→PAUSED、过期 lease recovery 先收敛 SUBMITTING、不重复 vendor call、所有终态严格计算 `COMPLETED`、`COMPLETED_WITH_ISSUES` 两种完整状态，contracts/type-test 拒绝 `ISSUES` 别名。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-batch.service.spec.ts
```

- [ ] **Step 3：实现 process**

先以 `PRINT_BATCH_PROCESS` claim 通用幂等记录，再条件更新 `READY|PAUSED -> RUNNING` + UUID lease owner + `now+60s`。按 job ID 取最多20个 PENDING，逐项委托 print-job service。请求 finally 重算计数；非终态→PAUSED；全终态且 failed/resolved=0→COMPLETED，否则 `COMPLETED_WITH_ISSUES`。process 与 lease recovery 审计逐项记录 actor/action/target/状态计数且无 PII；回滚无虚假 success。不得创建 cron/queue/后台 PENDING consumer。

- [ ] **Step 4：运行并发矩阵**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-batch.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- cloud-print-batches-mysql.e2e-spec.ts
```

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/test/cloud-print-batches-mysql.e2e-spec.ts
git commit -m "feat(api): process client-driven print batches"
```

### Task 7：实现 UNKNOWN 查询和人工收敛

**Files:**

- Create: `apps/api/src/printing/print-recovery.service.ts`
- Create: `apps/api/src/printing/print-recovery.service.spec.ts`
- Create: `apps/api/src/printing/dto/resolve-manual-print.dto.ts`
- Modify: `apps/api/src/printing/admin-print-jobs.controller.ts`
- Create: `apps/api/test/cloud-print-recovery-mysql.e2e-spec.ts`

- [ ] **Step 1：写 UNKNOWN 状态 RED 测试**

对 query UNKNOWN、三类 manualResolution、FAILED retry 和重复风险 retry 逐项覆盖：每次操作使用独立 key，controller 只从 HTTP `Idempotency-Key` header 取 key，缺失拒绝且 body 不携带；相同 key + 相同 canonical request hash replay 同一稳定 response snapshot/resource 且不重复查询 vendor 或创建 retry job；相同 key + 不同 canonical request hash 返回 conflict；并发只有一个 owner；外部查询完成/本地中断进入 UNKNOWN 并 reconcile。状态覆盖 query→ACCEPTED、query→FAILED、有限次数/时间窗后 `MANUAL_REVIEW`；duplicate-risk 原 job `MANUALLY_CLOSED` + 新一项 READY batch/PENDING job/supersedes 原子创建；`MANUAL_REVIEW` 阻止 batch 终态/设备解绑。contracts/type-test 拒绝 `CLOSED`/`MANUAL` 等别名。审计逐项验证 actor/action/target/无 payload PII，permission 拒绝有真实拒绝审计，回滚无虚假 success。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-recovery.service.spec.ts
```

- [ ] **Step 3：实现 recovery/manual service**

管理员 queryUnknown/`MANUAL_REVIEW` resolution/retry 操作要求 PRINT_EXECUTE，每个 endpoint 都从 HTTP `Idempotency-Key` header 读取 key 并复用 `AdminOperationIdempotencyService`。“知悉重复风险后再次打印”请求必须带显式确认布尔值；新 job 从订单快照重建，不复制超过 retention 的旧 payload，并原子创建非空 batch_id 的 READY 一项 batch。

- [ ] **Step 4：运行真实 MySQL**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-recovery.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- cloud-print-recovery-mysql.e2e-spec.ts
```

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/test/cloud-print-recovery-mysql.e2e-spec.ts
git commit -m "feat(api): resolve uncertain cloud print jobs"
```

### Task 8：实现批次取消与设备解绑引用门禁

**Files:**

- Modify: `apps/api/src/printing/print-batch.service.ts`
- Modify: `apps/api/src/printing/print-batch.service.spec.ts`
- Modify: `packages/shared-contracts/src/printing.ts`
- Modify: `packages/shared-contracts/src/printing.spec.ts`
- Modify: `packages/shared-contracts/src/printing-contracts.type-test.ts`
- Modify: `apps/api/src/printing/cloud-printer.service.ts`
- Modify: `apps/api/src/printing/admin-cloud-printers.controller.ts`
- Create: `apps/api/src/printing/dto/unbind-cloud-printer.dto.ts`
- Modify: `apps/api/src/printing/cloud-printer.service.spec.ts`
- Modify: `apps/api/test/cloud-print-batches-mysql.e2e-spec.ts`
- Modify: `apps/api/test/cloud-printer-recovery-mysql.e2e-spec.ts`
- Modify: `apps/admin-web/src/views/printing-devices/api/index.ts`
- Modify: `apps/admin-web/src/views/printing-devices/hooks/usePrintingDevices.ts`
- Modify: `apps/admin-web/src/views/printing-devices/hooks/usePrintingDevices.spec.ts`
- Modify: `apps/admin-web/src/views/printing-devices/components/PrinterRecoveryActions.vue`
- Modify: `apps/miniapp-shell/admin/api/printing-devices.ts`
- Modify: `apps/miniapp-shell/admin/hooks/printing-devices.ts`
- Modify: `apps/miniapp-shell/admin/hooks/printing-devices.spec.ts`
- Modify: `apps/miniapp-shell/admin/components/printer-list/index.{ts,json,wxml,wxss}`

- [ ] **Step 0：加载前端项目技能**

执行本 Task 的 Admin Web 改动前，必须通过 Skill 调用；CLI 不支持 Skill 时读取项目 skill 加载 `frontend-page-generator` 与 `js-functional-style`；按项目允许方式记录已加载结果。现有六职责边界保持不变，API 只组合全局 client，hook 使用不可变状态。

- [ ] **Step 1：写取消/解绑 RED 测试**

取消与解绑分别使用独立 key，controller 只从 HTTP `Idempotency-Key` header 读取且缺失拒绝；逐项覆盖相同 key + 相同 canonical request hash replay 同一稳定 response snapshot/resource 且不重复状态推进/vendor del，相同 key + 不同 canonical request hash conflict，并发只有一个 owner。取消只改变 PENDING→CANCELLED；ACCEPTED 保留；SUBMITTING/UNKNOWN/`MANUAL_REVIEW` 阻止取消终结和解绑；所有引用终态后可解绑。解绑必须验证 operation password、使用真实 print batch/job repository 门禁、短事务置 UNBINDING、事务外 vendor del；明确成功 UNBOUND，明确失败恢复原绑定状态，UNKNOWN 进入恢复且不重复 del。审计逐项覆盖 cancel/unbind/permission reject 的 actor/action/target/无 PII，回滚无虚假 success。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-batch.service.spec.ts src/printing/cloud-printer.service.spec.ts
```

- [ ] **Step 3：实现条件查询与状态重算**

0012 schema 已存在后，printer service 通过真实 print batch/job repository 查询所有非终态引用，不使用第三份计划的占位抽象。cancel 使用 `PRINT_BATCH_CANCEL`，unbind 使用 `PRINT_DEVICE_UNBIND`，二者复用 `AdminOperationIdempotencyService`。取消与计数重算同事务。解绑 controller 要求 PRINT_DEVICE_MANAGE、operation password 和 `Idempotency-Key`；外部 del 在事务外，UNKNOWN 由确认删除 reconcile 收敛。此 Task 同时把第三份计划双端设备 UI 的解绑控件从禁用说明切换为真实 API。

- [ ] **Step 4：运行矩阵**

```bash
pnpm --filter @bake-mall/api test:e2e -- cloud-print-batches-mysql.e2e-spec.ts cloud-printer-recovery-mysql.e2e-spec.ts
pnpm --filter @bake-mall/admin-web test -- src/views/printing-devices
pnpm --filter @bake-mall/miniapp-shell test -- admin/hooks/printing-devices.spec.ts
```

- [ ] **Step 5：提交**

```bash
git add packages/shared-contracts/src/printing* apps/api/src/printing apps/api/test/cloud-print* apps/admin-web/src/views/printing-devices apps/miniapp-shell/admin/api/printing-devices.ts apps/miniapp-shell/admin/hooks/printing-devices* apps/miniapp-shell/admin/components/printer-list
git commit -m "feat: cancel batches and enable printer unbinding"
```

### Task 9：实现 180 天 PII 清理

**Files:**

- Create: `apps/api/src/printing/print-retention.service.ts`
- Create: `apps/api/src/printing/print-retention.service.spec.ts`
- Create: `apps/api/src/printing/run-print-retention.ts`
- Create: `apps/api/test/cloud-print-retention-mysql.e2e-spec.ts`
- Modify: `apps/api/package.json`
- Modify: `docs/runbook/deployment.md`

- [ ] **Step 1：写 retention RED 测试**

```ts
expect(await service.redactExpiredPayloads(cutoff, 100)).toEqual({
  scanned: 3,
  redacted: 3,
});
expect(JSON.stringify(oldUnknown.payloadJson)).not.toContain('完整地址');
expect(oldUnknown.payloadHash).toBe(originalHash);
```

覆盖所有状态含 UNKNOWN/`MANUAL_REVIEW`、不延期、幂等、保留金额汇总/IDs/vendor/人工处置/audit、日志无旧 payload、脱敏后不能原 job 重试。retention 审计使用 SYSTEM actor、`PRINT_PAYLOAD_REDACTED` action、job target 和计数，不含 payload/地址/备注；批次回滚不得记录虚假清理 success。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-retention.service.spec.ts
```

- [ ] **Step 3：实现有限批次命令**

命令接受 cutoff/batch size，循环由外部 scheduler 驱动；service 每次只处理一批，先生成无 PII summary 再替换 payload。`apps/api/package.json` 增加 `printing:retention` 生产脚本。

- [ ] **Step 4：运行单元和 MySQL**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-retention.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- cloud-print-retention-mysql.e2e-spec.ts
```

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/test/cloud-print-retention-mysql.e2e-spec.ts apps/api/package.json docs/runbook/deployment.md
git commit -m "feat(api): redact expired cloud print payloads"
```

### Task 10：阶段四完整验证

- [ ] **Step 1：运行 contracts/API**

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/api test
pnpm --filter @bake-mall/api test:e2e -- cloud-print-jobs-mysql.e2e-spec.ts cloud-print-batches-mysql.e2e-spec.ts cloud-print-recovery-mysql.e2e-spec.ts cloud-print-retention-mysql.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api lint
pnpm --filter @bake-mall/api build
```

- [ ] **Step 2：运行迁移和格式**

```bash
pnpm --filter @bake-mall/api migration:run
pnpm exec prettier --check packages/shared-contracts/src apps/api/src apps/api/test
pnpm verify:workspace
git diff --check
```

- [ ] **Step 3：状态机审查**

专项 review 验证：无后台 PENDING consumer；所有 vendor call 事务外；幂等；UNKNOWN 不自动重发；计数不变量；解绑门禁；PII 清理。

- [ ] **Step 4：fake 厂商运行时验收**

实际启动 API + fake Xpyun，执行单张、50项三次process、部分失败、timeout/查询/`MANUAL_REVIEW` 处置、取消/解绑和 retention；确认日志无 PII/secret。

- [ ] **Step 5：提交阶段收口**

```bash
git add packages/shared-contracts apps/api docs/runbook/deployment.md
git commit -m "feat: complete cloud print job backend"
```
