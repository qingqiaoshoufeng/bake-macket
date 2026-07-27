# 默认四档会员等级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过版本化数据迁移向所有环境安全预装银卡、金卡、钻石卡、黑卡四个上架会员等级，且不覆盖商家已有配置。

**Architecture:** 新增 `0007` TypeORM 数据迁移，在事务内按稳定 code/rank 检测冲突并只插入缺失等级；down 在确认无购卡和会员引用后删除四档。迁移注册到现有 `data-source.ts`，测试同时覆盖 QueryRunner 单元行为与真实 MySQL 执行。

**Tech Stack:** NestJS 11、TypeORM、MySQL 8.4、TypeScript、Vitest、pnpm 9.15.4。

## 全局约束

- Node 使用 `v22.23.1`。
- 金额为整数分；折扣为整数基点。
- Schema 使用 `utf8mb4/utf8mb4_unicode_ci`，时间戳为 UTC `DATETIME`。
- 不修改已执行的 `0005`、`0006`。
- 迁移不覆盖已有会员配置，不给用户自动发卡。
- 新增 Nest/TypeScript 本地导入使用 `.js` 后缀。
- 先写失败测试，再实现迁移。
- 不提交代码，除非用户明确要求。

---

### Task 1: 实现默认会员等级迁移

**Files:**

- Create: `apps/api/src/database/migrations/0007-default-membership-levels.ts`
- Create: `apps/api/src/database/migrations/0007-default-membership-levels.spec.ts`
- Modify: `apps/api/src/database/data-source.ts`

**Interfaces:**

- Produces: `DefaultMembershipLevels1718000000006 implements MigrationInterface`
- Stable codes: `SILVER/GOLD/DIAMOND/BLACK`
- up: `Promise<void>`，冲突检测并插入缺失项
- down: `Promise<void>`，引用预检并安全删除

- [ ] **Step 1: 写迁移失败测试**

使用 QueryRunner double 记录 SQL 和事务调用，覆盖：

```ts
it('inserts four active levels with exact pricing and themes', async () => {
  await migration.up(queryRunner);
  expect(inserted).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'SILVER',
        priceCents: 9900,
        grantCreditCents: 1000,
        discountBasisPoints: 9500,
        theme: 'PEARL',
      }),
      expect.objectContaining({ code: 'BLACK', priceCents: 69900 }),
    ]),
  );
});
```

并断言同 code/rank 跳过、冲突抛错、down 引用拒绝。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH \
  pnpm --filter @bake-mall/api test -- \
  src/database/migrations/0007-default-membership-levels.spec.ts
```

Expected: FAIL，迁移文件不存在。

- [ ] **Step 3: 实现迁移常量与 up**

四档精确值：

```ts
[
  {
    code: 'SILVER',
    rank: 10,
    priceCents: 9900,
    grantCreditCents: 1000,
    discountBasisPoints: 9500,
    theme: 'PEARL',
  },
  {
    code: 'GOLD',
    rank: 20,
    priceCents: 19900,
    grantCreditCents: 3000,
    discountBasisPoints: 9000,
    theme: 'CHAMPAGNE',
  },
  {
    code: 'DIAMOND',
    rank: 30,
    priceCents: 39900,
    grantCreditCents: 8000,
    discountBasisPoints: 8500,
    theme: 'JADE',
  },
  {
    code: 'BLACK',
    rank: 40,
    priceCents: 69900,
    grantCreditCents: 16000,
    discountBasisPoints: 8000,
    theme: 'OBSIDIAN',
  },
];
```

所有档位 `validDays=365`、`sortOrder=rank`、`isActive=true`、`version=1`。用参数化 SQL 插入 JSON benefits，不拼接用户输入。

- [ ] **Step 4: 实现 down**

查询 `membership_purchase_orders` 和 `user_memberships` 引用数量；非零时抛出包含表名/数量的错误；安全时按稳定 code 删除。

- [ ] **Step 5: 注册迁移并运行单测**

在 `data-source.ts` 导入并追加 `DefaultMembershipLevels1718000000006`。

Run:

```bash
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH \
  pnpm --filter @bake-mall/api test -- \
  src/database/migrations/0007-default-membership-levels.spec.ts
```

Expected: PASS。

---

### Task 2: 增加真实 MySQL 迁移验收

**Files:**

- Create: `apps/api/test/default-membership-levels-migration.e2e-spec.ts`

**Interfaces:**

- Consumes: `DefaultMembershipLevels1718000000006`
- Produces: 真实 MySQL 对 JSON、enum、唯一索引和事务行为的证据

- [ ] **Step 1: 写真实 MySQL 失败测试**

使用现有 `test/helpers/mysql-test-database` 建立隔离库，应用 `0005` 后执行 `0007`，断言四行精确配置、顺序和 active 状态。

- [ ] **Step 2: 运行 e2e 确认测试约束有效**

Run:

```bash
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH \
  pnpm --filter @bake-mall/api test:e2e -- \
  default-membership-levels-migration.e2e-spec.ts
```

Expected: 若迁移未满足真实 MySQL 约束则 FAIL；修正 SQL 后 PASS。

- [ ] **Step 3: 覆盖幂等与回滚安全**

同库预插入已定制的 `GOLD`（同 code/rank，不同价格），执行 up 后断言价格未被覆盖；插入购卡引用后执行 down，断言拒绝且四档仍存在。

- [ ] **Step 4: 运行迁移和 API 包验证**

```bash
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api test
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api typecheck
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api lint
```

Expected: 全部 PASS。

---

### Task 3: 应用本地迁移并验收跨端数据

**Files:**

- Modify only if runtime verification exposes a defect in Task 1–2 files.

**Interfaces:**

- Consumes: 当前 `bake-mall-main` MySQL 和运行中的 API/H5/Admin
- Produces: 本地四档会员数据与 API/C 端验收结果

- [ ] **Step 1: 运行本地迁移**

加载根 `.env` 后执行 `pnpm --filter @bake-mall/api migration:run`。

Expected: `DefaultMembershipLevels1718000000006` 执行成功。

- [ ] **Step 2: 验证数据库**

查询 `membership_levels`，断言恰有四档稳定 code，金额、折扣、主题、rank、sortOrder 和 active 状态正确。

- [ ] **Step 3: 验证 API**

- Admin `/api/v1/admin/membership-levels?page=1&pageSize=20` 返回四档；
- Public `/api/v1/public/membership-levels` 返回四档；
- 顾客 `/api/v1/me/membership` 的新用户 `currentMembership` 仍为 null。

- [ ] **Step 4: 浏览器验收**

打开 Admin 会员卡配置和 H5 会员中心，检查银、金、钻石、黑卡的名称、主题、权益和顺序。

- [ ] **Step 5: 最终检查**

```bash
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api build
git diff --check
git status --short
```

Expected: build 通过，无临时文件进入工作树。
