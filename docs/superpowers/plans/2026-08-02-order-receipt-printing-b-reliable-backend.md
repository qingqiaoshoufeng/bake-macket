# 订单小票打印 B：可靠服务端 Implementation Plan

> **面向执行代理：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务实施。所有步骤使用复选框跟踪。

**目标：** 在不依赖 Android 或 Admin UI 的前提下，完成共享打印契约、MySQL schema、订单事务内初打任务、独立设备身份、任务租约、`LEASED → SENDING` 边界、结果回执、恢复、补打与 Admin API。

**架构：** `print_jobs` 作为订单事务内可靠 outbox；设备通过独立 `mall-device` 身份使用 HTTPS claim/heartbeat/start/ack/recover；MySQL 行锁与 `SKIP LOCKED` 协调设备；不确定物理结果进入人工确认。跨应用 DTO 只定义在 `@bake-mall/contracts`。

**技术栈：** NestJS 11、TypeORM、MySQL 8.4、Vitest、Supertest、JWT、bcrypt、Node crypto、pnpm workspace。

**前置阶段门：** 计划 A 已完成，`apps/merchant-terminal/src/capabilities/xinye-xp58iih.verified.json` 已通过真机测试。

**权威规格：** `docs/superpowers/specs/2026-08-02-order-receipt-printing-design.md`

---

## 文件结构

```text
packages/shared-contracts/src/printing.ts          跨应用单一事实来源
apps/api/src/database/migrations/index.ts          统一迁移注册
apps/api/src/database/migrations/0010-*.ts         打印 schema
apps/api/src/database/entities/print-*.ts          五个打印实体
apps/api/src/device-auth/                           mall-device 身份
apps/api/src/printing/                              payload、任务、租约和 Admin API
apps/api/test/*printing*.e2e-spec.ts                HTTP 与真实 MySQL
```

### Task 1：建立共享 printing contracts

**文件：**

- 创建：`packages/shared-contracts/src/printing.ts`
- 创建：`packages/shared-contracts/src/printing.spec.ts`
- 创建：`packages/shared-contracts/src/printing-wire-manifest.ts`
- 创建：`packages/shared-contracts/src/printing-wire-manifest.spec.ts`
- 修改：`packages/shared-contracts/src/enums.ts`
- 修改：`packages/shared-contracts/src/errors.ts`
- 修改：`packages/shared-contracts/src/index.ts`

- [ ] **Step 1：写状态机和类型失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  PrintJobStatus,
  canTransitionPrintJob,
  type PrintReceiptPayloadV1,
} from './printing.js';

describe('printing contracts', () => {
  it('keeps LEASED and SENDING recovery semantics distinct', () => {
    expect(
      canTransitionPrintJob(PrintJobStatus.LEASED, PrintJobStatus.SENDING),
    ).toBe(true);
    expect(
      canTransitionPrintJob(PrintJobStatus.SENDING, PrintJobStatus.PENDING),
    ).toBe(false);
    expect(
      canTransitionPrintJob(
        PrintJobStatus.SENDING,
        PrintJobStatus.NEEDS_CONFIRMATION,
      ),
    ).toBe(true);
  });

  it('rejects reprint payloads without a reason snapshot at compile time', () => {
    // @ts-expect-error reprint requires a reason snapshot
    const invalid: PrintReceiptPayloadV1 = {
      payloadVersion: 1,
      templateVersion: 'receipt-58-v1',
      print: { kind: 'REPRINT', generation: 1 },
    };
    expect(invalid).toBeDefined();
  });
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/contracts test -- src/printing.spec.ts src/printing-wire-manifest.spec.ts
pnpm --filter @bake-mall/contracts typecheck
```

Expected：FAIL，printing exports 尚不存在。

- [ ] **Step 3：实现共享枚举、payload 和 API DTO**

至少定义：

```ts
export enum PrintJobStatus {
  PENDING = 'PENDING',
  LEASED = 'LEASED',
  SENDING = 'SENDING',
  RETRY = 'RETRY',
  PRINTED = 'PRINTED',
  NEEDS_CONFIRMATION = 'NEEDS_CONFIRMATION',
  DEAD = 'DEAD',
}

export enum PrintJobKind {
  INITIAL = 'INITIAL',
  REPRINT = 'REPRINT',
}

export enum PrintJobTrigger {
  AUTO = 'AUTO',
  MANUAL = 'MANUAL',
}
```

同时定义 `PrintReceiptPayloadV1`、商家/履约/商品/金额快照、设备/设置/job/attempt view、pair/token/heartbeat、claim/start/ack/recover、Admin retry/reprint/confirm 请求响应、错误码和 `canTransitionPrintJob()`。pickup/delivery 与 initial/reprint 均使用可辨识联合。TypeScript 只约束补打必须包含原因；`generation > 0` 由共享运行时 guard、Nest DTO 校验和数据库服务共同执行。

`printing-wire-manifest.ts` 必须导出纯 JSON 可序列化的 `PRINTING_WIRE_MANIFEST_V1`，描述设备端所有 enum、对象字段、联合判别键、必填/可空、整数范围和 payloadVersion。它与 TypeScript 类型同文件常量/共享字段源生成或由测试逐字段互证，供计划 C 自动生成 UTS 类型/validator；不得包含函数或 TypeScript-only 语法。

- [ ] **Step 4：运行 contracts 全门禁**

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/contracts build
pnpm --filter @bake-mall/contracts lint
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add packages/shared-contracts/src
git commit -m "feat(contracts): add receipt printing contracts"
```

### Task 2：统一迁移注册表

**文件：**

- 创建：`apps/api/src/database/migrations/index.ts`
- 创建：`apps/api/src/database/migrations/index.spec.ts`
- 修改：`apps/api/src/database/data-source.ts`
- 修改：`apps/api/src/database/database.module.ts`
- 修改：`apps/api/test/admin-order-export-mysql.e2e-spec.ts`
- 修改：`apps/api/test/admin-order-supply.e2e-spec.ts`
- 修改：`apps/api/test/membership-levels-mysql.e2e-spec.ts`
- 修改：`apps/api/test/membership-order.e2e-spec.ts`
- 修改：`apps/api/test/membership-payment-concurrency.e2e-spec.ts`
- 修改：`apps/api/test/membership-void-concurrency.e2e-spec.ts`
- 修改：`apps/api/test/orders-pricing-mysql.e2e-spec.ts`
- 修改：`apps/api/test/orders-stock-concurrency-mysql.e2e-spec.ts`

- [ ] **Step 1：写注册一致性失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { DATABASE_MIGRATIONS } from './index.js';

describe('DATABASE_MIGRATIONS', () => {
  it('has unique monotonically increasing migration timestamps', () => {
    const names = DATABASE_MIGRATIONS.map((migration) => migration.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.at(0)).toContain('InitialSchema');
    expect(names.at(-1)).toContain('HomepagePages');
  });
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/index.spec.ts
```

Expected：FAIL，注册表不存在。

- [ ] **Step 3：建立单一注册数组**

```ts
export const DATABASE_MIGRATIONS = [
  InitialSchema1718000000000,
  ProductSortOrder1718000000001,
  Task12AdminMediaAndOrderIndexes1718000000002,
  SkuStockVersion1718000000003,
  MembershipAndOrderPricing1718000000004,
  MembershipEntitlementSegments1718000000005,
  DefaultMembershipLevels1718000000006,
  OrderItemSourceIds1718000000007,
  HomepagePages1718000000008,
] as const;
```

CLI、Nest runtime 和上述 8 个含 `migrations: [` 的真实 MySQL 测试统一导入此数组；相对导入带 `.js` 后缀。执行时再次用内容搜索 `migrations:\s*\[`，若发现新增手工列表也必须迁移，不能依赖文件名是否含 `mysql`。

- [ ] **Step 4：运行迁移相关门禁**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/index.spec.ts
pnpm --filter @bake-mall/api typecheck
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/database apps/api/test
git commit -m "refactor(api): centralize typeorm migration registry"
```

### Task 3：创建打印 schema 和实体

**文件：**

- 创建：`apps/api/src/database/migrations/0010-receipt-printing.ts`
- 创建：`apps/api/src/database/migrations/0010-receipt-printing.spec.ts`
- 创建：`apps/api/src/database/entities/print-device.entity.ts`
- 创建：`apps/api/src/database/entities/print-pairing-code.entity.ts`
- 创建：`apps/api/src/database/entities/print-setting.entity.ts`
- 创建：`apps/api/src/database/entities/print-job.entity.ts`
- 创建：`apps/api/src/database/entities/print-attempt.entity.ts`
- 创建：`apps/api/src/database/entities/printing-entities.spec.ts`
- 修改：`apps/api/src/database/entities/index.ts`
- 修改：`apps/api/src/database/migrations/index.ts`

- [ ] **Step 1：写 migration SQL 失败测试**

```ts
it('creates printing tables and keeps automatic printing disabled', async () => {
  await migration.up(queryRunner);
  expect(executedSql.join('\n')).toMatch(/CREATE TABLE `print_devices`/u);
  expect(executedSql.join('\n')).toMatch(/CREATE TABLE `print_jobs`/u);
  expect(executedSql.join('\n')).toMatch(
    /UNIQUE KEY `uq_print_jobs_order_generation` \(`order_id`, `generation`\)/u,
  );
  expect(executedSql.join('\n')).toMatch(
    /INSERT INTO `print_settings`.*VALUES \(1, 0,/su,
  );
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/0010-receipt-printing.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现迁移与实体**

严格创建规格中的五张表、外键、`UNIQUE(order_id,generation)` 和两个租约/队列索引。所有主键 `BIGINT UNSIGNED`，计数/时长 `INT UNSIGNED`，时间 UTC `DATETIME`，InnoDB/utf8mb4。`print_settings(id=1)` 默认 `auto_print_enabled=0`。实体 enum 使用共享 contracts。

- [ ] **Step 4：运行迁移与实体测试**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/0010-receipt-printing.spec.ts src/database/entities/printing-entities.spec.ts
pnpm --filter @bake-mall/api typecheck
```

设置正确的 worktree MySQL 环境后：

```bash
pnpm --filter @bake-mall/api migration:run
```

Expected：migration PASS，第二次执行无 pending migration。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/database
git commit -m "feat(api): add receipt printing schema"
```

### Task 4：构建不可变 payload 和 hash

**文件：**

- 创建：`apps/api/src/printing/receipt-payload.ts`
- 创建：`apps/api/src/printing/receipt-payload.spec.ts`
- 创建：`apps/api/src/printing/payload-hash.ts`
- 创建：`apps/api/src/printing/payload-hash.spec.ts`

- [ ] **Step 1：写快照和 hash 失败测试**

```ts
it('builds a stable payload without attempt-time fields', () => {
  const payload = buildPrintReceiptPayloadV1({
    order,
    items,
    settings,
    jobShortCode: 'P8X2K7',
    kind: PrintJobKind.INITIAL,
    generation: 0,
  });
  expect(payload.amounts).toEqual({
    goodsTotalCents: 6800,
    membershipDiscountCents: 680,
    creditAppliedCents: 2000,
    payableTotalCents: 4120,
  });
  expect(payload).not.toHaveProperty('printedAt');
  expect(hashPrintPayload(payload)).toBe(
    hashPrintPayload(structuredClone(payload)),
  );
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/receipt-payload.spec.ts src/printing/payload-hash.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现纯 builder 与 canonical hash**

```ts
export function buildPrintReceiptPayloadV1(
  input: Readonly<{
    order: Order;
    items: readonly OrderItem[];
    settings: PrintSetting;
    jobShortCode: string;
    kind: PrintJobKind;
    generation: number;
    reprintReason?: ReprintReasonSnapshot;
  }>,
): PrintReceiptPayloadV1;

export function canonicalizePrintPayload(
  payload: PrintReceiptPayloadV1,
): string;
export function hashPrintPayload(payload: PrintReceiptPayloadV1): string;
```

canonicalization 递归排序对象 key、保留数组顺序，以 UTF-8 JSON 做 SHA-256；不得包含 attempt `startedAt`。builder 只接受 Order/OrderItem/PrintSetting 快照，不回查 Product/Sku/Address/Membership。

- [ ] **Step 4：扩展并运行测试**

覆盖配送/自提、会员有无、补打原因、金额不变量、控制字符、实时实体修改不影响已构造 payload、日志 helper 不输出完整电话/地址。

```bash
pnpm --filter @bake-mall/api test -- src/printing/receipt-payload.spec.ts src/printing/payload-hash.spec.ts
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing
git commit -m "feat(api): build immutable receipt payloads"
```

### Task 5：订单事务内创建自动初打任务

**文件：**

- 创建：`apps/api/src/printing/print-job-factory.service.ts`
- 创建：`apps/api/src/printing/print-job-factory.service.spec.ts`
- 修改：`apps/api/src/orders/orders.service.ts`
- 修改：`apps/api/src/orders/orders.module.ts`
- 修改：`apps/api/src/orders/orders.service.spec.ts`
- 创建：`apps/api/test/order-print-transaction-mysql.e2e-spec.ts`

- [ ] **Step 1：写事务失败测试**

```ts
it('rolls back the order when the enabled print job insert fails', async () => {
  await expect(createOrderWithPrintInsertFailure()).rejects.toThrow();
  expect(await orderRepo.count()).toBe(0);
  expect(await printJobRepo.count()).toBe(0);
  expect(await idempotencyRepo.count()).toBe(0);
  expect((await skuRepo.findOneByOrFail({ id: sku.id })).stock).toBe(5);
  expect(await cartRepo.count()).toBe(1);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test:e2e -- order-print-transaction-mysql.e2e-spec.ts
```

Expected：FAIL，订单尚未创建任务。

- [ ] **Step 3：实现事务内 factory**

```ts
export class PrintJobFactoryService {
  async createAutoInitialJob(
    manager: EntityManager,
    input: Readonly<{ order: Order; items: readonly OrderItem[] }>,
  ): Promise<PrintJob | null>;
}
```

必须使用传入 manager：锁 `print_settings(id=1)`；关闭则返回 null；开启则构造 `INITIAL/AUTO/generation=0`、payload/hash 并插入。调用位置在 `order_items` save 后、cart delete 和 idempotency complete 前。

- [ ] **Step 4：运行完整事务矩阵**

覆盖关闭不创建、开启创建、幂等重放一条、库存失败无任务、消费金失败无任务、任务失败全回滚。

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-job-factory.service.spec.ts src/orders/orders.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- order-print-transaction-mysql.e2e-spec.ts
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/src/orders apps/api/test/order-print-transaction-mysql.e2e-spec.ts
git commit -m "feat(api): atomically enqueue initial receipt jobs"
```

### Task 6：实现独立设备配对和鉴权

**文件：**

- 创建：`apps/api/src/device-auth/device-auth.module.ts`
- 创建：`apps/api/src/device-auth/device-auth.controller.ts`
- 创建：`apps/api/src/device-auth/device-auth.service.ts`
- 创建：`apps/api/src/device-auth/device-auth.service.spec.ts`
- 创建：`apps/api/src/device-auth/device-jwt.guard.ts`
- 创建：`apps/api/src/device-auth/current-device.decorator.ts`
- 创建：`apps/api/src/device-auth/dto/pair-device.dto.ts`
- 创建：`apps/api/src/device-auth/dto/device-token.dto.ts`
- 创建：`apps/api/test/device-auth.e2e-spec.ts`
- 修改：`apps/api/src/auth/auth.constants.ts`
- 修改：`apps/api/src/auth/auth.types.ts`
- 修改：`apps/api/src/config/env.schema.ts`
- 修改：`apps/api/src/app.module.ts`
- 修改：`.env.development.example`
- 修改：`.env.production.example`

- [ ] **Step 1：写 audience 和撤销失败测试**

```ts
it('rejects admin/user tokens and revoked device tokens', async () => {
  await request(app)
    .post('/api/v1/device/heartbeat')
    .set(userHeaders)
    .expect(401);
  await request(app)
    .post('/api/v1/device/heartbeat')
    .set(adminHeaders)
    .expect(401);
  await disableDevice(device.id);
  await request(app)
    .post('/api/v1/device/heartbeat')
    .set(deviceHeaders)
    .expect(401);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test:e2e -- device-auth.e2e-spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现安全配对和 token**

```ts
export const JWT_DEVICE_AUDIENCE = 'mall-device' as const;
export type DeviceJwtPayload = Readonly<{
  sub: string;
  aud: 'mall-device';
  tokenVersion: number;
}>;
```

六位配对码使用 bcrypt 慢哈希，5 分钟、一次性、失败上限；API 事务性消费后生成 256-bit credential，只返回一次，数据库只存 bcrypt hash。短期 JWT 使用独立 `JWT_DEVICE_SECRET`；guard 每次查设备 ACTIVE/tokenVersion。Nest DTO class `implements` 共享请求类型且相对导入带 `.js`。

- [ ] **Step 4：运行安全矩阵**

```bash
pnpm --filter @bake-mall/api test -- src/device-auth
pnpm --filter @bake-mall/api test:e2e -- device-auth.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
```

Expected：配对码过期/重用/爆破、credential 错误、三 audience 交叉、停用与 tokenVersion 均按预期拒绝。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/device-auth apps/api/src/auth apps/api/src/config apps/api/src/app.module.ts apps/api/test/device-auth.e2e-spec.ts .env.development.example .env.production.example
git commit -m "feat(api): add isolated print device authentication"
```

### Task 7：实现 claim、heartbeat 和 `/start`

**文件：**

- 创建：`apps/api/src/printing/printing.module.ts`
- 创建：`apps/api/src/printing/device-print-jobs.controller.ts`
- 创建：`apps/api/src/printing/print-job-lease.service.ts`
- 创建：`apps/api/src/printing/print-job-lease.service.spec.ts`
- 创建：`apps/api/src/printing/lease-token.ts`
- 创建：`apps/api/src/printing/lease-token.spec.ts`
- 创建：`apps/api/test/print-job-claim-mysql.e2e-spec.ts`
- 修改：`apps/api/src/app.module.ts`

- [ ] **Step 1：写真实 MySQL 双设备并发 RED 测试**

```ts
const [first, second] = await Promise.all([
  firstService.claim(firstDevice, now),
  secondService.claim(secondDevice, now),
]);
expect([first, second].filter(Boolean)).toHaveLength(1);
expect(await printJobRepo.countBy({ status: PrintJobStatus.LEASED })).toBe(1);
```

同时写 `/start` 前任务必须 LEASED、旧 token 不可 start 的断言。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test:e2e -- print-job-claim-mysql.e2e-spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现 lease service**

```ts
claim(device: AuthenticatedDevice, now: Date): Promise<ClaimPrintJobResponse | null>;
heartbeat(jobId: string, device: AuthenticatedDevice, input: PrintJobHeartbeatRequest, now: Date): Promise<PrintJobLeaseView>;
start(jobId: string, device: AuthenticatedDevice, input: StartPrintJobRequest, now: Date): Promise<StartPrintJobResponse>;
```

claim 首先将过期 SENDING 条件更新为 NEEDS_CONFIRMATION，再以 `pessimistic_write` + `setOnLocked('skip_locked')` 从 PENDING、到期 RETRY、过期 LEASED 选一条。`/start` 条件必须包含 id/status/device/leaseHash/未过期，原子创建 attempt、`attempt_count+1`、返回服务端 startedAt。明文 lease token 只在响应中出现。

- [ ] **Step 4：运行并发和单元测试**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-job-lease.service.spec.ts src/printing/lease-token.spec.ts
pnpm --filter @bake-mall/api test:e2e -- print-job-claim-mysql.e2e-spec.ts
```

Expected：双设备只有一个领取；过期 LEASED 可回收；SENDING 不进入 claim；旧 token 不能 heartbeat/start。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/src/app.module.ts apps/api/test/print-job-claim-mysql.e2e-spec.ts
git commit -m "feat(api): add skip-locked print job leasing"
```

### Task 8：实现 ACK、退避和 recover

**文件：**

- 创建：`apps/api/src/printing/print-job-result.service.ts`
- 创建：`apps/api/src/printing/print-job-result.service.spec.ts`
- 创建：`apps/api/src/printing/retry-policy.ts`
- 创建：`apps/api/src/printing/retry-policy.spec.ts`
- 创建：`apps/api/test/print-job-results-mysql.e2e-spec.ts`
- 修改：`apps/api/src/printing/device-print-jobs.controller.ts`

- [ ] **Step 1：写结果状态机 RED 测试**

```ts
it('never retries an uncertain write automatically', async () => {
  const result = await service.ack(
    job.id,
    device,
    {
      leaseToken,
      result: 'UNCERTAIN',
      attemptNo: 1,
      durationMs: 900,
      errorCode: 'PRINTER_CONNECTION_LOST_DURING_WRITE',
      renderedBytesHash: null,
    },
    now,
  );
  expect(result.status).toBe(PrintJobStatus.NEEDS_CONFIRMATION);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-job-result.service.spec.ts src/printing/retry-policy.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现结果策略**

```ts
export const retryDelayMs = (attemptNo: number): number =>
  [2000, 5000, 15000, 30000, 60000][Math.min(attemptNo - 1, 4)]!;
```

`ack()` 和 `recover()` 使用 manager 事务更新 job + attempt。成功 ACK 幂等；旧 token 拒绝；FAILED 根据错误码 RETRY/DEAD；UNCERTAIN 到 NEEDS_CONFIRMATION；SENT recover 只补 ACK；本地 SENDING/损坏/冲突不重打。`renderedBytesHash` 只写 attempt，不保存 bytes。

- [ ] **Step 4：运行单元和真实 MySQL**

```bash
pnpm --filter @bake-mall/api test -- src/printing/print-job-result.service.spec.ts src/printing/retry-policy.spec.ts
pnpm --filter @bake-mall/api test:e2e -- print-job-results-mysql.e2e-spec.ts
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/test/print-job-results-mysql.e2e-spec.ts
git commit -m "feat(api): finalize print attempts and lease recovery"
```

### Task 9：完成 Admin printing API 和补打并发

**文件：**

- 创建：`apps/api/src/printing/admin-printing.controller.ts`
- 创建：`apps/api/src/printing/admin-printing.service.ts`
- 创建：`apps/api/src/printing/admin-printing.service.spec.ts`
- 创建：`apps/api/test/admin-printing.e2e-spec.ts`
- 创建：`apps/api/test/print-reprint-concurrency-mysql.e2e-spec.ts`
- 修改：`apps/api/src/printing/printing.module.ts`
- 修改：`apps/api/src/orders/orders.module.ts`

- [ ] **Step 1：写设置、初打和补打 RED 测试**

```ts
it('requires a healthy device before enabling automatic printing', async () => {
  await expect(
    service.updateSettings(admin.id, { version: 1, autoPrintEnabled: true }),
  ).rejects.toMatchObject({
    response: expect.objectContaining({ code: 'PRINT_DEVICE_REQUIRED' }),
  });
});

it('allocates unique reprint generations under concurrency', async () => {
  const results = await Promise.all([
    service.createReprint(order.id, admin.id, reason),
    service.createReprint(order.id, admin.id, reason),
  ]);
  expect(results.map(({ generation }) => generation).sort()).toEqual([1, 2]);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/printing/admin-printing.service.spec.ts
```

Expected：FAIL。

- [ ] **Step 3：实现 Admin 行为**

```ts
updateSettings(adminId: string, input: UpdatePrintSettingsRequest): Promise<PrintSettingsView>;
retryInitialJob(orderId: string, adminId: string): Promise<PrintJobView>;
createReprint(orderId: string, adminId: string, input: CreateReprintRequest): Promise<PrintJobView>;
confirmPrinted(jobId: string, adminId: string): Promise<PrintJobView>;
```

设置 version 乐观锁；启用要求最近 60 秒 ACTIVE 且诊断通过设备。无任务的首次手动打印在订单锁内创建 INITIAL/MANUAL generation 0；PENDING/RETRY 只提前 availableAt；DEAD 仅安全错误可重置；PRINTED/人工确认后创建 REPRINT；generation 在订单行锁内递增；“其他”原因必须说明。人工确认写 AuditLog，`printedAt` 保持 null 以区分终端发送。

- [ ] **Step 4：运行 HTTP、并发和包级门禁**

```bash
pnpm --filter @bake-mall/api test -- src/printing/admin-printing.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- admin-printing.e2e-spec.ts
pnpm --filter @bake-mall/api test:e2e -- print-reprint-concurrency-mysql.e2e-spec.ts
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api lint
pnpm --filter @bake-mall/api build
```

Expected：PASS。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/printing apps/api/src/orders/orders.module.ts apps/api/test/admin-printing.e2e-spec.ts apps/api/test/print-reprint-concurrency-mysql.e2e-spec.ts
git commit -m "feat(api): complete admin printing operations"
```

## 计划 B 完成标准

- contracts 是跨应用唯一事实来源；
- schema、runtime、CLI 和真实 MySQL 共享迁移列表；
- 自动打印开启时订单与初打任务原子提交；
- `mall-device` 与用户/管理员 audience 隔离，撤销立即生效；
- 真实 MySQL 证明 `SKIP LOCKED`、LEASED/SENDING、旧 token、ACK 幂等、recover 和补打 generation；
- 不依赖 Android 或 Admin UI 即可完成全部服务端验收。
