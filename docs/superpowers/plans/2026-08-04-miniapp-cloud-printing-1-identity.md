# 身份合并与 OPERATOR 管理身份 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended); alternatively use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立安全的 placeholder 用户合并、可立即撤销的顾客/管理员 token、SUPER_ADMIN/OPERATOR 角色、普通管理员双登录和首次改密闭环。

**Architecture:** 先建立统一 TypeORM 迁移注册表，再通过 `0011-user-admin-identity` 原子迁移 User tombstone/token version、Admin role/linked-user/version/每管理员精确限流字段、固定 1024 行公开登录 bucket、可辨识审计 actor 和微信一次性 credential claim。User 合并固定保留手机号 placeholder 为 canonical，所有手机号与 `phoneVerified` 更新只能经过 `UserIdentityService`；OPERATOR 通过 `linked_user_id` 关联消费用户并签发独立 `mall-admin` token。管理员登录统一为一个可辨识联合 endpoint：公开登录按 `HMAC(kind + normalized identifier)` 使用固定 bucket，known 管理员另叠加精确窗口但不提前改变公开响应；首次改密、普通改密和高风险二次验证继续共用每管理员精确窗口、密码策略、hash 和 tokenVersion 失效规则。

**兼容说明：** 迁移源文件编号为 `0011`，但为兼容已执行的 outcrop 历史，migration class/name 必须继续保持 `UserAdminIdentity1718000000009`，不得改名或重复执行。

**Tech Stack:** NestJS 11、TypeORM、MySQL 8.4、bcrypt、JWT、Vitest、Supertest、`@bake-mall/contracts`。

**权威规格：** `docs/superpowers/specs/2026-08-03-miniapp-cloud-printing-user-admin-design.md` 第 5、6、10.1、10.2、18.1、21 节。

---

## 文件结构

```text
packages/shared-contracts/src/
├─ auth.ts                         管理角色、可辨识登录联合、受限/完整会话、首次/普通改密 DTO
├─ admin-user.ts                   用户列表、创建、授权、撤权 DTO
├─ enums.ts / errors.ts / index.ts 统一导出
└─ *contracts*.spec.ts             运行时/类型级契约

apps/api/src/database/
├─ migrations/index.ts             CLI/runtime/MySQL 测试唯一迁移列表
├─ migrations/0011-user-admin-identity.ts
├─ entities/user.entity.ts
├─ entities/admin-user.entity.ts
├─ entities/admin-login-verification-bucket.entity.ts
├─ entities/audit-log.entity.ts
├─ entities/wechat-credential-use.entity.ts
└─ entities/index.ts

apps/api/src/auth/
├─ user-auth.service.ts            tokenVersion 会话和合并后的新会话
├─ user-jwt.guard.ts               active/merged/version 数据库校验
├─ admin-auth.service.ts           统一可辨识登录、换管理会话、首次/普通改密
├─ admin-password-policy.ts        ASCII 数字且长度至少 6 的纯函数策略
├─ admin-jwt.guard.ts              role/version/linked User 校验
├─ admin-verification.service.ts   固定公开登录 bucket、每管理员精确窗口与密码验证
├─ dto/*.ts                        implements shared request types
└─ *.spec.ts

apps/api/src/users/
├─ users.module.ts
├─ user-identity.service.ts        手机号与 phoneVerified 唯一写入口
├─ user-identity.service.spec.ts
├─ user-identity-merge.service.ts  placeholder canonical 合并
└─ user-identity-merge.service.spec.ts

apps/api/src/audit/
├─ audit.service.ts                Admin/User/System 可辨识 actor
└─ audit.service.spec.ts

apps/api/test/
├─ user-identity-merge-mysql.e2e-spec.ts
└─ operator-auth.e2e-spec.ts
```

### Task 1：统一 TypeORM 迁移注册表

**Files:**

- Create: `apps/api/src/database/migrations/index.ts`
- Create: `apps/api/src/database/migrations/index.spec.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/database/database.module.ts`
- Modify: every `apps/api/test/*.ts` file containing an inline `migrations: [` list

- [ ] **Step 1：写迁移注册一致性失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { DATABASE_MIGRATIONS } from './index.js';

describe('DATABASE_MIGRATIONS', () => {
  it('keeps unique monotonically ordered migration names', () => {
    const names = DATABASE_MIGRATIONS.map(({ name }) => name);
    expect(names).toHaveLength(9);
    expect(new Set(names)).toHaveLength(names.length);
    expect(names.at(0)).toBe('InitialSchema1718000000000');
    expect(names.at(-1)).toBe('HomepagePages1718000000008');
  });
});
```

- [ ] **Step 2：运行并确认 RED**

Run:

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/index.spec.ts
```

Expected: FAIL，`./index.js` 不存在。

- [ ] **Step 3：建立唯一注册数组**

```ts
import { InitialSchema1718000000000 } from './0001-initial-schema.js';
import { ProductSortOrder1718000000001 } from './0002-product-sort-order.js';
import { Task12AdminMediaAndOrderIndexes1718000000002 } from './0003-task12-admin-media-and-order-indexes.js';
import { SkuStockVersion1718000000003 } from './0004-sku-stock-version.js';
import { MembershipAndOrderPricing1718000000004 } from './0005-membership-and-order-pricing.js';
import { MembershipEntitlementSegments1718000000005 } from './0006-membership-entitlement-segments.js';
import { DefaultMembershipLevels1718000000006 } from './0007-default-membership-levels.js';
import { OrderItemSourceIds1718000000007 } from './0008-order-item-source-ids.js';
import { HomepagePages1718000000008 } from './0009-homepage-pages.js';

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

将 CLI、runtime 和真实 MySQL 测试全部改为导入 `DATABASE_MIGRATIONS`。搜索命令必须返回除注册表测试外无手写列表：

```bash
rg -n "migrations:\s*\[" apps/api/src apps/api/test
```

- [ ] **Step 4：运行门禁**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/index.spec.ts
pnpm --filter @bake-mall/api typecheck
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/database apps/api/test
git commit -m "refactor(api): centralize database migrations"
```

### Task 2：定义身份、角色与用户管理共享契约

**Files:**

- Create: `packages/shared-contracts/src/admin-user.ts`
- Modify: `packages/shared-contracts/src/auth.ts`
- Modify: `packages/shared-contracts/src/enums.ts`
- Modify: `packages/shared-contracts/src/errors.ts`
- Modify: `packages/shared-contracts/src/index.ts`
- Modify: `packages/shared-contracts/src/admin-contracts.spec.ts`
- Modify: `packages/shared-contracts/src/admin-contracts.type-test.ts`

- [ ] **Step 1：写角色、permission 和会话契约 RED 测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  AdminPermission,
  AdminRole,
  OPERATOR_PERMISSIONS,
  type AdminSessionView,
  type GrantOperatorRequest,
} from './index.js';

describe('admin identity contracts', () => {
  it('locks the operator permission allowlist', () => {
    expect(OPERATOR_PERMISSIONS).toEqual([
      AdminPermission.ORDER_READ,
      AdminPermission.ORDER_STATUS_UPDATE,
      AdminPermission.USER_READ,
      AdminPermission.USER_CREATE,
      AdminPermission.PRINT_DEVICE_MANAGE,
      AdminPermission.PRINT_EXECUTE,
      AdminPermission.PRINT_HISTORY_READ,
      AdminPermission.SELF_PASSWORD_CHANGE,
    ]);
  });

  it('discriminates restricted and full admin sessions', () => {
    const restricted: AdminSessionView = {
      accessToken: 'token',
      expiresAt: '2026-08-04T00:00:00.000Z',
      role: AdminRole.OPERATOR,
      permissions: [],
      mustChangePassword: true,
    };
    expect(restricted.mustChangePassword).toBe(true);

    // @ts-expect-error confirmation is required
    const invalid: GrantOperatorRequest = {
      currentPassword: '123456',
      temporaryPassword: '654321',
    };
    expect(invalid).toBeDefined();
  });
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/contracts test -- src/admin-contracts.spec.ts
pnpm --filter @bake-mall/contracts typecheck
```

Expected: FAIL，角色和请求类型尚不存在。

- [ ] **Step 3：实现共享契约**

精确定义：

```ts
export enum AdminRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  OPERATOR = 'OPERATOR',
}

export enum AdminPermission {
  ORDER_READ = 'ORDER_READ',
  ORDER_STATUS_UPDATE = 'ORDER_STATUS_UPDATE',
  USER_READ = 'USER_READ',
  USER_CREATE = 'USER_CREATE',
  PRINT_DEVICE_MANAGE = 'PRINT_DEVICE_MANAGE',
  PRINT_EXECUTE = 'PRINT_EXECUTE',
  PRINT_HISTORY_READ = 'PRINT_HISTORY_READ',
  SELF_PASSWORD_CHANGE = 'SELF_PASSWORD_CHANGE',
}

export const OPERATOR_PERMISSIONS = Object.freeze([
  AdminPermission.ORDER_READ,
  AdminPermission.ORDER_STATUS_UPDATE,
  AdminPermission.USER_READ,
  AdminPermission.USER_CREATE,
  AdminPermission.PRINT_DEVICE_MANAGE,
  AdminPermission.PRINT_EXECUTE,
  AdminPermission.PRINT_HISTORY_READ,
  AdminPermission.SELF_PASSWORD_CHANGE,
] as const);
```

`AdminSessionView` 必须携带 role、permissions、mustChangePassword；登录请求只定义一个联合，不创建重叠的 operator login DTO：

```ts
export type AdminLoginRequest =
  | { kind: 'SUPER_ADMIN'; email: string; password: string }
  | { kind: 'OPERATOR'; phone: string; password: string };

export interface ChangeAdminPasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}
```

其余请求类型为 `ExchangeOperatorSessionRequest`、`ChangeInitialOperatorPasswordRequest`、`GrantOperatorRequest`、`RevokeOperatorRequest`。`admin-user.ts` 定义用户列表、placeholder 创建和管理员状态 view。错误码明确覆盖身份合并冲突、必须改密、验证限流、管理员权限不足、微信 credential 重放/处理中冲突。类型测试拒绝缺少 `kind`、混合 email/phone 字段和不完整三字段改密请求。

- [ ] **Step 4：运行 contracts 全门禁**

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/contracts build
pnpm --filter @bake-mall/contracts lint
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/shared-contracts/src
git commit -m "feat(contracts): add operator identity contracts"
```

### Task 3：创建身份安全迁移与实体约束

**Files:**

- Create: `apps/api/src/database/migrations/0011-user-admin-identity.ts`
- Create: `apps/api/src/database/migrations/0011-user-admin-identity.spec.ts`
- Modify: `apps/api/src/database/migrations/index.ts`
- Modify: `apps/api/src/database/migrations/index.spec.ts`
- Modify: `apps/api/src/database/entities/user.entity.ts`
- Modify: `apps/api/src/database/entities/admin-user.entity.ts`
- Create: `apps/api/src/database/entities/admin-login-verification-bucket.entity.ts`
- Modify: `apps/api/src/database/entities/audit-log.entity.ts`
- Create: `apps/api/src/database/entities/wechat-credential-use.entity.ts`
- Modify: `apps/api/src/database/entities/index.ts`
- Modify: `apps/api/src/audit/audit.service.ts`
- Modify: `apps/api/src/audit/audit.service.spec.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Modify: `apps/api/src/orders/admin-orders.controller.ts`
- Modify: `apps/api/src/homepage/homepage.service.ts`
- Modify: `apps/api/src/membership/membership.service.ts`
- Modify: `apps/api/src/membership/membership-purchase.service.ts`
- Modify: `apps/api/src/banner/banner.service.ts`
- Modify: all existing `apps/api/src/**/*.spec.ts` fixtures calling `AuditService.record`
- Create: `apps/api/src/database/entities/user-admin-identity.spec.ts`
- Create: `apps/api/src/database/entities/admin-login-verification-bucket.entity.spec.ts`
- Create: `apps/api/src/database/entities/wechat-credential-use.entity.spec.ts`

- [ ] **Step 1：写迁移 SQL RED 测试**

断言：

```ts
expect(sql).toMatch(/ADD COLUMN `is_active` tinyint\(1\) NOT NULL DEFAULT 1/u);
expect(sql).toMatch(/ADD COLUMN `merged_into_user_id` bigint unsigned NULL/u);
expect(sql).toMatch(
  /ADD COLUMN `token_version` int unsigned NOT NULL DEFAULT 1/u,
);
expect(sql).toMatch(/ADD COLUMN `role` enum\('SUPER_ADMIN','OPERATOR'\)/u);
expect(sql).toMatch(/ADD COLUMN `linked_user_id` bigint unsigned NULL/u);
expect(sql).toMatch(/UPDATE `admin_users` SET `role` = 'SUPER_ADMIN'/u);
expect(sql).toMatch(/UNIQUE KEY `uq_admin_users_linked_user`/u);
```

同时断言 `audit_logs.actor_type` 为 `ADMIN | USER | SYSTEM`，`admin_user_id` nullable，新增 nullable `user_id`，组合 CHECK 精确保证 ADMIN 只有 admin、USER 只有 user、SYSTEM 二者皆空；现有审计回填 `ADMIN`。断言 `wechat_credential_uses` 包含 `kind enum('LOGIN','PHONE')`、唯一 `credential_hash char(64)`、`status enum('IN_PROGRESS','COMPLETED','FAILED')`、`expires_at`、nullable `resource_user_id`、nullable `response_snapshot`，且不存在明文 code 字段。

同时断言新表 `admin_login_verification_buckets` 只有固定公开登录聚合字段：`bucket_id smallint unsigned` 主键、`failed_count int unsigned`、nullable UTC `window_started_at` 与 UTC `updated_at`；迁移预置且只预置 `0..1023` 共 1024 行。表内不得有 email、phone、identifier hash、admin ID 或逐次 attempt/audit 字段；`admin_users.verify_failed_count`/`verify_window_started_at` 保留为 known 管理员公开登录叠加保护及首次/普通改密、高风险二次验证的每管理员精确窗口。

`down` 先执行全部 guard query；存在 `OPERATOR`、tombstone User、任意 `wechat_credential_uses` 域数据、任一 `audit_logs.actor_type != 'ADMIN'`（包括 `USER`/`SYSTEM`）记录，或任一公开登录 bucket 的 `failed_count > 0`/`window_started_at IS NOT NULL` 时即抛错。RED 测试分别插入五类 guard fixture，执行 `down` 后对迁移前后 tables/columns/indexes/check constraints 做快照断言，证明零 DDL、schema 完全不变；仅当五类域数据都不存在且 1024 个 bucket 均为空闲时，才恢复旧 audit actor 列并删除新增身份字段、bucket 表和 credential 表。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/0011-user-admin-identity.spec.ts
```

Expected: FAIL，迁移不存在。

- [ ] **Step 3：实现迁移和实体**

遵循 `BIGINT UNSIGNED`、`INT UNSIGNED`、`SMALLINT UNSIGNED`、`TINYINT(1)` boolean、UTC `DATETIME`。`admin_users.username` 改为 nullable，MySQL 唯一索引允许多个 null。MySQL 8.4 创建完整角色组合 CHECK：`SUPER_ADMIN` 必须 `username IS NOT NULL AND linked_user_id IS NULL`，`OPERATOR` 必须 `username IS NULL AND linked_user_id IS NOT NULL`；实体和 service 同时维护该不变量。`users.merged_into_user_id` 自引用 `RESTRICT`。迁移以确定性 SQL 预置固定 1024 个 `admin_login_verification_buckets`，不为标识符动态增删行；无 Redis 的首期有界存储方案明确接受 unknown 标识符不能精确隔离以及碰撞导致可用性更严格的权衡。

`AuditService.record` 接受可辨识 actor union：

```ts
type AuditActor =
  | { type: 'ADMIN'; adminUserId: string }
  | { type: 'USER'; userId: string }
  | { type: 'SYSTEM' };
```

所有现有调用显式传 `{ type: 'ADMIN', adminUserId }`，保持原 Admin 审计语义。credential entity 只保存 `sha256(code)`；通过唯一键和带过期时间的条件更新安全 claim/reclaim，绝不保存、日志记录、回显明文 code。

将迁移追加到 `DATABASE_MIGRATIONS`，更新注册表测试期望 10 项和尾项名称。

- [ ] **Step 4：运行单元、typecheck 和真实迁移**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/0011-user-admin-identity.spec.ts src/database/entities/user-admin-identity.spec.ts src/database/entities/admin-login-verification-bucket.entity.spec.ts src/database/entities/wechat-credential-use.entity.spec.ts src/audit/audit.service.spec.ts src/database/migrations/index.spec.ts
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api migration:run
pnpm --filter @bake-mall/api migration:run
```

Expected: 第一次应用 `0011` 并精确创建 1024 个空闲 bucket，第二次无 pending migration；迁移测试已逐项证明存在 `OPERATOR`、tombstone User、`wechat_credential_uses` 域数据、任一 `audit_logs.actor_type != 'ADMIN'` 记录或任一活动 bucket 时 `down` 拒绝且零 DDL、schema 不变，五类 guard 均通过时才允许回滚。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/database apps/api/src/audit apps/api/src/orders apps/api/src/homepage apps/api/src/membership apps/api/src/banner
git commit -m "feat(api): add identity audit and wechat credential schema"
```

### Task 4：让 mall-user token 可立即失效

**Files:**

- Modify: `apps/api/src/auth/auth.types.ts`
- Modify: `apps/api/src/auth/user-auth.service.ts`
- Modify: `apps/api/src/auth/user-jwt.guard.ts`
- Modify: `apps/api/src/auth/user-jwt.guard.spec.ts`
- Modify: `apps/api/src/auth/auth.service.spec.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/test/auth-isolation.e2e-spec.ts`

- [ ] **Step 1：写 tokenVersion RED 测试**

```ts
it('rejects a user token after the persisted token version changes', async () => {
  jwt.verifyAsync.mockResolvedValue({
    sub: '7',
    aud: 'mall-user',
    phone: '13800000000',
    tokenVersion: 1,
  });
  users.findOne.mockResolvedValue({
    id: '7',
    phone: '13800000000',
    isActive: true,
    mergedIntoUserId: null,
    tokenVersion: 2,
  });

  await expect(guard.canActivate(context)).rejects.toThrow(
    'Invalid or expired token',
  );
});
```

覆盖 inactive、merged tombstone、缺失用户、版本一致成功。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/auth/user-jwt.guard.spec.ts src/auth/auth.service.spec.ts
```

Expected: FAIL，payload/guard 未查询版本。

- [ ] **Step 3：实现数据库校验 guard 和签发版本**

`UserJwtPayload` 增加 `tokenVersion`；`UserAuthService.issueSession` 从实体读取版本；`JwtUserGuard` 注入 `Repository<User>`，验证实体 active、未 merged、version 一致，再构造 principal。所有相对导入带 `.js`。

- [ ] **Step 4：运行认证门禁**

```bash
pnpm --filter @bake-mall/api test -- src/auth
pnpm --filter @bake-mall/api test:e2e -- auth-isolation.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
```

Expected: PASS，两个 audience 仍交叉拒绝。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/auth apps/api/test/auth-isolation.e2e-spec.ts
git commit -m "feat(api): make customer sessions revocable"
```

### Task 5：建立 UserIdentityService 并实现 placeholder 用户原子合并

**Files:**

- Create: `apps/api/src/users/users.module.ts`
- Create: `apps/api/src/users/user-identity.service.ts`
- Create: `apps/api/src/users/user-identity.service.spec.ts`
- Create: `apps/api/src/users/user-identity-merge.service.ts`
- Create: `apps/api/src/users/user-identity-merge.service.spec.ts`
- Modify: `apps/api/src/audit/audit.service.ts`
- Modify: `apps/api/src/audit/audit.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/auth/user-auth.service.ts`
- Modify: `apps/api/src/auth/auth.service.spec.ts`
- Create: `apps/api/src/users/user-identity-write-boundary.spec.ts`
- Create: `apps/api/test/user-identity-merge-mysql.e2e-spec.ts`

- [ ] **Step 1：写 canonical 合并 RED 单测**

覆盖：

```ts
it('keeps the phone placeholder as canonical and tombstones the source', async () => {
  const result = await service.mergeVerifiedPhone({
    authenticatedUserId: 'source-2',
    normalizedPhone: '13800000000',
  });

  expect(result.userId).toBe('placeholder-1');
  expect(savedCanonical).toMatchObject({
    phoneVerified: true,
    tokenVersion: 2,
  });
  expect(savedSource).toMatchObject({
    isActive: false,
    mergedIntoUserId: 'placeholder-1',
    tokenVersion: 2,
    wechatOpenid: null,
    wechatUnionid: null,
  });
});
```

再覆盖同一记录、OpenID/UnionID 冲突、订单/会员/credit 财务事实阻断、地址重挂、购物车同 SKU 合并、数量上限冲突、OPERATOR 关联唯一冲突。`UserIdentityService` 单测证明手机号变化以及 `phoneVerified: true -> false` 与关联 OPERATOR `tokenVersion++` 同事务；`user-identity-write-boundary.spec.ts` 扫描 API 源码并禁止 `UserIdentityService` 之外的 service/repository 对 `users.phone` 与 `users.phone_verified` 执行直接赋值和 update；同时把现有 `UserAuthService.bindPhone` 改为委托该 service。

审计测试明确：成功合并在同一业务事务以 `{ type: 'USER', userId: canonicalId }` 写成功 actor/action/target 和无 PII summary；事务回滚时成功审计一并回滚。确定性拒绝需要审计时，业务事务外单独写 `SECURITY_IDENTITY_MERGE_REJECTED` 安全审计，只记录 actor、canonical/source 内部 ID、拒绝分类和计数，不写手机号/OpenID/UnionID，且绝不伪造 merge success。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/users/user-identity.service.spec.ts src/users/user-identity-merge.service.spec.ts src/users/user-identity-write-boundary.spec.ts
```

Expected: FAIL，service 不存在。

- [ ] **Step 3：实现稳定锁序和合并**

固定事务锁序：按 User ID 升序锁 placeholder/source → 双方 AdminUser → 地址 → 购物车 → 财务事实 existence query。仅允许迁移地址、购物车、微信身份和管理员关联。存在订单、购卡、会员、credit entry/allocation 等事实时抛共享确定性错误。所有手机号/`phoneVerified` 写入委托 `UserIdentityService`；该 service 在值变化时锁定 linked OPERATOR 并在同一事务递增其 `tokenVersion`。合并后 `UserAuthService.bindPhone` 直接返回 canonical 新 `mall-user` 会话，而非旧 user profile。成功 merge 审计由同一个 `EntityManager` 以 USER actor 写入。

- [ ] **Step 4：运行单元和真实 MySQL 并发矩阵**

```bash
pnpm --filter @bake-mall/api test -- src/users/user-identity.service.spec.ts src/users/user-identity-merge.service.spec.ts src/users/user-identity-write-boundary.spec.ts src/auth/auth.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- user-identity-merge-mysql.e2e-spec.ts
```

真实测试使用随机 schema + `DATABASE_MIGRATIONS`，覆盖两个并发验证只有一个收敛结果、事务失败完整回滚、临时 schema/user/grant 清理。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/users apps/api/src/auth apps/api/src/app.module.ts apps/api/test/user-identity-merge-mysql.e2e-spec.ts
git commit -m "feat(api): merge placeholder customer identities"
```

### Task 6：实现固定公开登录 bucket 与管理员精确验证窗口

**Files:**

- Create: `apps/api/src/auth/admin-verification.service.ts`
- Create: `apps/api/src/auth/admin-verification.service.spec.ts`
- Modify: `apps/api/src/auth/auth.module.ts`

- [ ] **Step 1：写固定 bucket 与 5 分钟 5 次精确窗口 RED 测试**

公开登录 bucket 覆盖：

```ts
it('returns 401 for the first five bucket failures and 429 on the sixth', async () => {
  const identifier = { kind: 'OPERATOR', normalized: '13800000000' } as const;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await expect(
      service.verifyPublicLogin(identifier, 'wrong'),
    ).rejects.toMatchObject({ status: 401 });
  }
  await expect(
    service.verifyPublicLogin(identifier, 'wrong'),
  ).rejects.toMatchObject({ status: 429 });
});
```

再覆盖：`HMAC(kind + normalized identifier)` 稳定映射到 `0..1023` 且不持久化标识符；known/unknown 在同一 bucket 序列的公开响应完全相同；人为构造碰撞时共享计数并更严格；known 管理员叠加 `admin_users` 精确窗口，但精确窗口已耗尽而 bucket 未到第 6 次时仍只返回通用 `401`；公开登录成功只清管理员精确窗口、不清 bucket；公开失败只更新 bucket 聚合，任何公开登录结果都不逐次调用 `AuditService.record`。

已认证验证覆盖首次改密、普通改密和高风险二次验证复用每管理员精确窗口：前 5 次失败返回验证错误、第 6 次限流、窗口过期重置、成功清零、每次成功/失败/限流均写脱敏 `AuditLog`，以及 SUPER_ADMIN/OPERATOR 使用各自 hash。

两类路径都覆盖并发第 5/6 次边界，证明条件更新不能被绕过；bucket/管理员双层更新使用固定锁序且无死锁。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/auth/admin-verification.service.spec.ts
```

Expected: FAIL，固定 bucket 映射、公开登录聚合和分层验证尚未实现。

- [ ] **Step 3：实现有界聚合与原子验证**

service 接收 `EntityManager`；未传 manager 时自行开启短事务。公开登录先规范化可辨识联合中的 email/phone，以服务端 secret 执行 HMAC 并映射到固定 1024 行之一；按固定锁序先锁 bucket，再在 known 时锁 AdminUser。bucket 是 known/unknown 外部 `401`/`429` 的唯一判定源；管理员精确窗口只叠加内部保护，不能提前改变公开响应。失败聚合到 bucket；known 失败同时更新精确窗口；成功只重置精确窗口，不重置 bucket。不得按 unknown 标识符创建行，也不得把标识符、普通 hash 或逐次 attempt 写入 bucket/AuditLog。

首次改密、普通改密和高风险二次验证只锁 AdminUser 并复用其 5 分钟 5 次精确窗口；失败原子递增，成功清零，每次结果通过 `AuditService.record` 记录 admin ID、结果和窗口计数，不含密码与 PII。无 Redis 默认固定 1024 bucket，以有界存储接受 unknown 无法精确隔离及碰撞可用性更严格的权衡。

- [ ] **Step 4：运行测试**

```bash
pnpm --filter @bake-mall/api test -- src/auth/admin-verification.service.spec.ts src/audit/audit.service.spec.ts
pnpm --filter @bake-mall/api typecheck
```

Expected: PASS；公开 known/unknown 仅由 bucket 决定响应，公开登录不逐次审计，已认证验证逐次脱敏审计，并发边界无绕过或死锁。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/auth
git commit -m "feat(api): rate limit admin password verification"
```

### Task 7：实现 OPERATOR 授权、撤权与统一管理员登录

**Files:**

- Modify: `apps/api/src/auth/admin-auth.service.ts`
- Modify: `apps/api/src/auth/admin-auth.controller.ts`
- Modify: `apps/api/src/auth/admin-jwt.guard.ts`
- Modify: `apps/api/src/auth/auth.types.ts`
- Modify: `apps/api/src/auth/current-user.decorator.ts`
- Modify: `apps/api/src/auth/dto/admin-login.dto.ts`
- Create: `apps/api/src/auth/dto/exchange-operator-session.dto.ts`
- Create: `apps/api/src/auth/dto/change-initial-operator-password.dto.ts`
- Create: `apps/api/src/auth/admin-password-policy.ts`
- Create: `apps/api/src/auth/admin-password-policy.spec.ts`
- Create: `apps/api/src/auth/admin-permission.guard.ts`
- Create: `apps/api/src/auth/admin-permission.decorator.ts`
- Create: `apps/api/src/auth/operator-auth.service.spec.ts`
- Create: `apps/api/src/users/admin-users.controller.ts`
- Create: `apps/api/src/users/admin-users.service.ts`
- Create: `apps/api/src/users/dto/grant-operator.dto.ts`
- Create: `apps/api/src/users/dto/revoke-operator.dto.ts`
- Create: `apps/api/test/operator-auth.e2e-spec.ts`

- [ ] **Step 1：写授权、密码策略、可辨识登录和受限会话 RED 测试**

覆盖：`/admin/auth/login` 只接受 `{ kind: 'SUPER_ADMIN', email, password }` 与 `{ kind: 'OPERATOR', phone, password }`；混合字段 400；两种 kind 均先规范化标识符并进入 Task 6 固定 bucket，known/unknown 外部只由 bucket 决定前 5 次通用 `401`、第 6 次 `429`；known 管理员精确窗口不能提前改变响应，成功重置精确窗口但不重置 bucket，公开失败不产生逐次 `AuditLog`；SUPER_ADMIN 当前密码通过已认证精确验证后创建 OPERATOR；username null、linked user、临时 hash、mustChange true；普通管理员无法授权；OPERATOR 手机号+密码登录；mall-user 换管理会话；linked phone 未验证拒绝；首次改密必须三字段并走每管理员精确窗口、成功直接返回完整会话；撤权 version++ 且旧 token 401。

密码纯函数断言设置临时密码或新操作密码时只接受 ASCII 数字且长度不少于 6，拒绝空格、全角数字、字母、5 位密码，并由首次改密的新密码、普通改密的新密码和授权临时密码统一调用。公开登录与已认证的当前/临时密码验证必须始终进入 Task 6 的 bucket/精确窗口和 bcrypt 路径，不得按候选密码格式提前拒绝：这既保持 known/unknown 外部一致性，也兼容迁移前已存在的 SUPER_ADMIN 强密码与默认开发密码；密码一旦通过改密或授权重新设置，才受新策略约束。

```ts
expect(validateAdminPassword('123456')).toEqual({ ok: true });
expect(validateAdminPassword('１２３４５６')).toEqual({
  ok: false,
  code: 'ADMIN_PASSWORD_POLICY_VIOLATION',
});
expect(restricted).toMatchObject({
  role: AdminRole.OPERATOR,
  permissions: [],
  mustChangePassword: true,
});
expect(full.permissions).toEqual(OPERATOR_PERMISSIONS);
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/auth/admin-password-policy.spec.ts src/auth/operator-auth.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- operator-auth.e2e-spec.ts
```

Expected: FAIL，统一联合 DTO、策略和角色会话尚未实现。

- [ ] **Step 3：实现统一登录、角色会话与管理接口**

只保留一个 `POST /api/v1/admin/auth/login`，修改现有 `admin-login.dto.ts` 对两个 `kind` 分支执行运行时可辨识校验，并通过返回 `AdminLoginRequest` 的映射方法建立共享契约边界；不要让单个 DTO class 直接 `implements` 联合类型（TypeScript 不允许 class 实现 union），也不创建重叠的 `operator-login.dto.ts`。endpoint 必须在查询管理员前完成 kind 对应的标识符规范化和固定 bucket 映射，并统一调用 Task 6 的公开登录路径，不能在 controller/service 分支中泄露 known/unknown；公开登录 attempt 不逐次写 AuditLog。`AdminJwtPayload` 包含 role/tokenVersion/linkedUserId；guard 每次查询 AdminUser，OPERATOR 同时查询 linked User verified/active；`@RequireAdminPermissions(...permissions)` 元数据由 `AdminPermissionGuard` 默认拒绝 OPERATOR，SUPER_ADMIN 全部通过。受限 token 只允许首次改密、退出和身份查询。授权/撤权及其当前密码验证写 AuditService 且不记录密码。

本任务只完成身份、授权/撤权与会话闭环；八项 permission 对既有业务 endpoint 的逐路由接线、用户列表/创建 API 及其双端 UI 仍属于下一份 `2026-08-04-miniapp-cloud-printing-2-permissions-users.md`，不得在本任务扩展已实现范围。

- [ ] **Step 4：运行身份安全矩阵**

```bash
pnpm --filter @bake-mall/api test -- src/auth src/users
pnpm --filter @bake-mall/api test:e2e -- operator-auth.e2e-spec.ts auth-isolation.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api lint
```

Expected: PASS；两个公开登录 kind 对 known/unknown 均严格表现为 bucket 前 5 次 `401`、第 6 次 `429`，碰撞共享更严格限制，known 精确窗口不提前改变响应，成功只重置精确窗口且公开登录不产生逐次 AuditLog；授权/撤权、受限/完整会话和 tokenVersion 即时失效保持通过。

- [ ] **Step 5：提交**

```bash
git add apps/api/src/auth apps/api/src/users apps/api/test/operator-auth.e2e-spec.ts
git commit -m "feat(api): add revocable operator sessions"
```

### Task 8：实现超级管理员与普通管理员普通改密

**Files:**

- Modify: `packages/shared-contracts/src/auth.ts`
- Modify: `packages/shared-contracts/src/admin-contracts.spec.ts`
- Modify: `packages/shared-contracts/src/admin-contracts.type-test.ts`
- Modify: `apps/api/src/auth/admin-auth.controller.ts`
- Modify: `apps/api/src/auth/admin-auth.service.ts`
- Create: `apps/api/src/auth/dto/change-admin-password.dto.ts`
- Modify: `apps/api/src/auth/operator-auth.service.spec.ts`
- Modify: `apps/api/test/operator-auth.e2e-spec.ts`

- [ ] **Step 1：写普通改密 RED 测试**

逐角色覆盖 `POST /api/v1/admin/auth/password`：完整 `mall-admin` 会话提交 `{ currentPassword, newPassword, confirmPassword }`；三字段缺失、确认不一致、策略不符、当前密码错误、每管理员 5 分钟 5 次精确限流均拒绝；每次验证成功、失败和限流均写脱敏 `AuditLog`；成功 bcrypt 保存新 hash、`tokenVersion++`、精确失败窗口清零、旧 token 401，并直接返回新的完整 `AdminSessionView`。受限首次会话只能调用首次改密 endpoint，不能调用普通改密。

```ts
expect(result).toMatchObject({
  role: AdminRole.OPERATOR,
  mustChangePassword: false,
  permissions: OPERATOR_PERMISSIONS,
});
expect(savedAdmin.tokenVersion).toBe(previousVersion + 1);
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/contracts test -- src/admin-contracts.spec.ts
pnpm --filter @bake-mall/api test -- src/auth/operator-auth.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- operator-auth.e2e-spec.ts
```

Expected: FAIL，普通改密契约和 endpoint 尚未实现。

- [ ] **Step 3：实现统一普通改密路径**

DTO class `implements ChangeAdminPasswordRequest`。service 对 SUPER_ADMIN 与 OPERATOR 读取各自 hash，复用 `AdminVerificationService`、`validateAdminPassword` 与每管理员精确失败窗口，不访问公开登录 bucket；成功更新 bcrypt hash、`lastPasswordChangedAt`、`tokenVersion`，重置精确窗口并以新版本签发完整会话。每次当前密码验证结果均逐次脱敏审计；改密成功另使用当前 ADMIN actor、`ADMIN_PASSWORD_CHANGED` action 和 admin target，只记录角色与结果，不包含任一密码值与 hash。

- [ ] **Step 4：运行改密与 audience 门禁**

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/api test -- src/auth
pnpm --filter @bake-mall/api test:e2e -- operator-auth.e2e-spec.ts auth-isolation.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
```

Expected: PASS，两个角色收到新完整 session，旧 token 立即失效。

- [ ] **Step 5：提交**

```bash
git add packages/shared-contracts/src apps/api/src/auth apps/api/test/operator-auth.e2e-spec.ts
git commit -m "feat(api): change admin operation passwords"
```

### Task 9：阶段一完整验证

- [ ] **Step 1：运行 contracts**

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/contracts build
pnpm --filter @bake-mall/contracts lint
```

- [ ] **Step 2：运行 API 定向及全量**

```bash
pnpm --filter @bake-mall/api test
pnpm --filter @bake-mall/api test:e2e -- user-identity-merge-mysql.e2e-spec.ts operator-auth.e2e-spec.ts auth-isolation.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api lint
pnpm --filter @bake-mall/api build
```

- [ ] **Step 3：运行格式和差异门禁**

```bash
pnpm exec prettier --check packages/shared-contracts/src apps/api/src apps/api/test
pnpm verify:workspace
git diff --check
```

Expected: 全部 PASS；随机 schema/user/grant 无残留；公开登录固定 1024 bucket 的 known/unknown 一致响应、碰撞更严格、并发第 5/6 次边界、成功不重置 bucket、known 精确窗口成功重置，以及公开 attempt 不逐次审计均有覆盖；首次/普通改密和高风险二次验证的精确窗口与逐次脱敏审计通过。0011 `down` guard 阶段验证覆盖 `audit_logs.actor_type != 'ADMIN'` 任一记录或任一活动 bucket 即拒绝回滚，并以迁移前后 schema 快照确认拒绝路径零 DDL、schema 不变。

- [ ] **Step 4：审查**

执行一轮规格符合性审查，再执行一轮代码质量/安全审查；修复后复验，不重复机械审查。

- [ ] **Step 5：提交阶段收口**

```bash
git add packages/shared-contracts apps/api
git commit -m "feat: complete operator identity foundation"
```
