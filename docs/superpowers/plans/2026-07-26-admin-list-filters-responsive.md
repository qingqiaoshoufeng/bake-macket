# 商家后台列表筛选与宽度自适配实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 6 个商家后台列表页提供一致的宽度自适应查询区、完整服务端过滤与分页，并修正表格滚动及订单应付金额展示。

**Architecture:** `@bake-mall/contracts` 统一定义分页、过滤枚举和列表查询契约；Nest API 使用 DTO 验证并通过 TypeORM QueryBuilder 在数据库执行过滤与分页；Admin 使用轻量 `AdminFilterPanel` 提供自适应 Grid、更多筛选与统一操作区，各页面保留自己的字段模板和查询状态。现有数据库字段足以支持本轮需求，不新增 schema 迁移。

**Tech Stack:** pnpm workspace、TypeScript 5、Vue 3、Vite、Element Plus、NestJS 11、TypeORM、MySQL 8、Vitest。

## 全局约束

- Node 使用 `v22.23.1`，命令前设置 `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH`。
- 跨 API/Admin 的 DTO、枚举和分页结果只定义在 `@bake-mall/contracts`。
- 金额只使用整数分；Admin 输入的元文本通过 `yuanTextToCents()` 转换。
- 查询时间范围统一为 `from <= value < before`。
- 查询字段根据容器宽度使用 `repeat(auto-fit, minmax(min(100%, 220px), 1fr))` 自动换行，不维护页面级分辨率断点。
- 业务行为使用 TDD；先运行失败测试，再实现最小行为。
- 新增 Nest 源文件使用 `.js` 导入后缀。
- JavaScript/TypeScript 遵循不可变与 ES6 数组方法风格。
- 不提交代码，除非用户另行明确要求。

---

## 文件结构与职责

### 共享契约

- `packages/shared-contracts/src/admin-list.ts`：统一分页、布尔过滤、库存过滤与共用范围字段。
- `packages/shared-contracts/src/admin-catalog.ts`：分类、商品、Banner 后台查询和分页结果。
- `packages/shared-contracts/src/admin-order.ts`：订单高级查询字段和完整金额列表项。
- `packages/shared-contracts/src/membership.ts`：会员卡、购卡记录高级查询及分页结果。
- `packages/shared-contracts/src/index.ts`：导出新增契约。
- `packages/shared-contracts/src/admin-contracts.type-test.ts`、`membership-contracts.type-test.ts`：类型级合法/非法形态断言。

### API

- `apps/api/src/common/dto/admin-page-query.dto.ts`：`page/pageSize` 的 class-validator 基类。
- `apps/api/src/common/query/admin-query.helpers.ts`：LIKE 转义、范围顺序校验与分页结果构造。
- `apps/api/src/catalog/dto/admin-category-list-query.dto.ts`：分类查询参数验证。
- `apps/api/src/catalog/dto/admin-product-list-query.dto.ts`：商品查询参数验证。
- `apps/api/src/banner/dto/admin-banner-list-query.dto.ts`：Banner 查询参数验证。
- `apps/api/src/orders/dto/admin-order-list-query.dto.ts`：扩展订单查询参数。
- `apps/api/src/membership/dto/admin-membership-level-query.dto.ts`：会员卡查询参数。
- `apps/api/src/membership/dto/admin-membership-purchase-query.dto.ts`：购卡记录查询参数。
- 对应 controller/service：接收 DTO、数据库过滤、稳定排序与分页。
- 对应 `*.spec.ts`：验证组合过滤、边界、分页、金额和非法参数。

### Admin 共用层

- `apps/admin-web/src/components/filters/AdminFilterPanel.vue`：基础/更多 slot、自适应 Grid、操作区和筛选计数。
- `apps/admin-web/src/components/filters/AdminFilterPanel.spec.ts`：展开、重置、查询、loading 和布局 class。
- `apps/admin-web/src/config/pagination.ts`：统一页码和 pageSize 选项。
- `apps/admin-web/src/utils/list-query.ts`：去除空参数、日期范围映射、活动条件计数。
- `apps/admin-web/src/utils/list-query.spec.ts`：纯函数测试。

### Admin 页面域

每个列表域补齐或统一：

```text
views/<domain>/
├── components/<Domain>Filters.vue
├── config/defaults.ts
├── config/filter-options.ts
├── config/pagination.ts（改为复用全局配置时删除）
├── hooks/use<Domain>.ts
├── type/index.ts
├── api/index.ts
└── <Domain>View.vue
```

组件只渲染字段并 emit；hooks 管理草稿条件、已应用条件、竞态保护、分页和 API 转换。

---

### Task 1: 建立统一后台列表契约

**Files:**

- Create: `packages/shared-contracts/src/admin-list.ts`
- Modify: `packages/shared-contracts/src/admin-catalog.ts`
- Modify: `packages/shared-contracts/src/admin-order.ts`
- Modify: `packages/shared-contracts/src/membership.ts`
- Modify: `packages/shared-contracts/src/index.ts`
- Test: `packages/shared-contracts/src/admin-contracts.type-test.ts`
- Test: `packages/shared-contracts/src/membership-contracts.type-test.ts`

**Interfaces:**

- Produces:
  - `PaginatedView<T> = { items: T[]; total: number; page: number; pageSize: number }`
  - `BooleanFilter = 'YES' | 'NO'`
  - `ProductStockFilter = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'`
  - `AdminCategoryListQuery/Result`
  - `AdminProductListQuery/Result`
  - `AdminBannerListQuery/Result`
  - 扩展后的 `AdminOrderListQuery`
  - 扩展后的 `AdminMembershipLevelListQuery/Result`
  - 扩展后的 `AdminMembershipPurchaseListQuery/Result`

- [ ] **Step 1: 写类型级失败断言**

在 type-test 中加入合法查询，并使用 `@ts-expect-error` 拒绝浮点金额、非法枚举和缺少分页字段：

```ts
const productQuery: AdminProductListQuery = {
  q: '蛋糕',
  stock: ProductStockFilter.LOW_STOCK,
  lowStockThreshold: 10,
  minPriceCents: 1000,
  maxPriceCents: 5000,
  page: 1,
  pageSize: 20,
};

// @ts-expect-error stock 只接受 ProductStockFilter
const invalidProductQuery: AdminProductListQuery = {
  stock: 'LOW',
  page: 1,
  pageSize: 20,
};
```

- [ ] **Step 2: 运行测试确认失败**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/contracts typecheck`

Expected: FAIL，提示新增类型或枚举不存在。

- [ ] **Step 3: 实现契约**

分类查询字段：`q/isActive/hasImage/hasProducts/createdAtFrom/createdAtBefore/page/pageSize`。

商品查询字段：`q/categoryId/isActive/hasActiveSku/stock/lowStockThreshold/hasCoverImage/minPriceCents/maxPriceCents/createdAtFrom/createdAtBefore/page/pageSize`。

Banner 查询字段：`q/isActive/targetType/targetId/targetValid/createdAtFrom/createdAtBefore/page/pageSize`。

订单新增：`contact/userId/itemQ/usesMembership/usesCredit/hasRemark/minPayableCents/maxPayableCents`。

会员卡新增：`rank/minPriceCents/maxPriceCents/minDiscountBasisPoints/maxDiscountBasisPoints/hasPurchases/theme/minValidDays/maxValidDays/updatedAtFrom/updatedAtBefore/page/pageSize`。

购卡记录新增：`userPhone/paymentStatus/minPriceCents/maxPriceCents/voidable/paidAtFrom/paidAtBefore/voidedAtFrom/voidedAtBefore`；保留 `levelId` 作为 API 值。

所有 Result 使用 `PaginatedView<T>` 类型别名。

- [ ] **Step 4: 验证契约**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/contracts test && pnpm --filter @bake-mall/contracts typecheck && pnpm --filter @bake-mall/contracts build`

Expected: PASS，且 `dist/index.d.ts` 导出新增类型。

---

### Task 2: 实现共用 API 查询验证与目录/Banner 服务端过滤

**Files:**

- Create: `apps/api/src/common/dto/admin-page-query.dto.ts`
- Create: `apps/api/src/common/query/admin-query.helpers.ts`
- Create: `apps/api/src/common/query/admin-query.helpers.spec.ts`
- Create: `apps/api/src/catalog/dto/admin-category-list-query.dto.ts`
- Create: `apps/api/src/catalog/dto/admin-product-list-query.dto.ts`
- Create: `apps/api/src/banner/dto/admin-banner-list-query.dto.ts`
- Modify: `apps/api/src/catalog/admin-categories.controller.ts`
- Modify: `apps/api/src/catalog/admin-products.controller.ts`
- Modify: `apps/api/src/catalog/catalog.service.ts`
- Modify: `apps/api/src/catalog/product.mapper.ts`
- Modify: `apps/api/src/banner/admin-banner.controller.ts`
- Modify: `apps/api/src/banner/banner.service.ts`
- Test: `apps/api/src/catalog/catalog.service.spec.ts`
- Test: `apps/api/src/banner/banner.service.spec.ts`

**Interfaces:**

- Consumes: Task 1 查询和分页类型。
- Produces:
  - `escapeLike(value: string): string`
  - `toPaginatedView<T>(items, total, page, pageSize): PaginatedView<T>`
  - `CatalogService.listAdminCategories(query): Promise<AdminCategoryListResult>`
  - `CatalogService.listAdminProducts(query): Promise<AdminProductListResult>`
  - `BannerService.list(query): Promise<AdminBannerListResult>`

- [ ] **Step 1: 写 helper 和 service 失败测试**

覆盖 `%/_/\\` 转义、分类组合过滤、商品 SKU/库存/价格过滤、Banner 目标有效性、排他时间上界和稳定分页。

商品断言示例：

```ts
await expect(
  service.listAdminProducts({
    stock: ProductStockFilter.OUT_OF_STOCK,
    page: 1,
    pageSize: 20,
  }),
).resolves.toMatchObject({
  items: [expect.objectContaining({ name: '售罄吐司' })],
  total: 1,
});
```

- [ ] **Step 2: 运行定向测试确认失败**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api test -- src/common/query/admin-query.helpers.spec.ts src/catalog/catalog.service.spec.ts src/banner/banner.service.spec.ts`

Expected: FAIL，新 DTO/helper/signature 尚不存在。

- [ ] **Step 3: 实现 DTO 与 controller**

使用 `@IsOptional/@IsEnum/@IsInt/@Min/@Max/@IsISO8601/@Type` 验证参数；controller 使用 `@Query() query` 并返回分页结果。

- [ ] **Step 4: 实现 QueryBuilder 过滤**

分类通过 `EXISTS/NOT EXISTS` 判断关联商品；商品使用 SKU 聚合子查询产生 `activeSkuCount/minPriceCents/maxStock/totalStock`，避免逐商品查询；Banner 通过关联目标的存在和启用状态判断 `targetValid`。

分页排序：分类/商品/Banner 保留 `sortOrder ASC, createdAt DESC`，追加 `id DESC`。

- [ ] **Step 5: 运行定向测试**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api test -- src/common/query/admin-query.helpers.spec.ts src/catalog/catalog.service.spec.ts src/banner/banner.service.spec.ts`

Expected: PASS。

---

### Task 3: 扩展订单过滤并修复应付金额

**Files:**

- Modify: `apps/api/src/orders/dto/admin-order-list-query.dto.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Test: `apps/api/src/orders/dto/admin-order-list-query.dto.spec.ts`
- Test: `apps/api/src/orders/orders.service.spec.ts`

**Interfaces:**

- Consumes: 扩展后的 `AdminOrderListQuery`。
- Produces: `listAdminOrders()` 支持联系人/手机、用户、商品/SKU、会员、消费金、备注、金额和时间组合过滤；列表项始终返回完整金额字段。

- [ ] **Step 1: 写 DTO 与 service 失败测试**

覆盖非法金额/时间、联系人模糊匹配、订单项 `EXISTS`、会员和消费金布尔过滤、备注、应付金额范围，以及会员折扣订单列表项：

```ts
expect(result.items[0]).toMatchObject({
  goodsTotalCents: 10_000,
  membershipDiscountCents: 1_000,
  creditAppliedCents: 2_000,
  payableTotalCents: 7_000,
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api test -- src/orders/dto/admin-order-list-query.dto.spec.ts src/orders/orders.service.spec.ts`

Expected: FAIL，新字段未参与查询或列表 mapper 缺字段。

- [ ] **Step 3: 实现 DTO 与 QueryBuilder**

联系人条件匹配 `contact_name OR contact_phone`；商品/SKU 使用 `order_items` 的 `EXISTS`；布尔过滤用 `membership_id IS [NOT] NULL`、`credit_applied_cents > 0/=0`、`remark IS [NOT] NULL AND remark <> ''`；金额直接过滤 `payable_total_cents`。

- [ ] **Step 4: 修正列表 mapper**

从实体返回 `membershipDiscountCents/creditAppliedCents/payableTotalCents`，前端不再依赖商品总额回退。

- [ ] **Step 5: 运行订单测试**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api test -- src/orders/dto/admin-order-list-query.dto.spec.ts src/orders/orders.service.spec.ts`

Expected: PASS。

---

### Task 4: 实现会员卡与购卡记录数据库过滤分页

**Files:**

- Create: `apps/api/src/membership/dto/admin-membership-level-query.dto.ts`
- Modify: `apps/api/src/membership/dto/admin-membership-purchase-query.dto.ts`
- Modify: `apps/api/src/membership/admin-membership.controller.ts`
- Modify: `apps/api/src/membership/admin-membership-purchases.controller.ts`
- Modify: `apps/api/src/membership/membership.service.ts`
- Modify: `apps/api/src/membership/membership-purchase.service.ts`
- Test: `apps/api/src/membership/membership.service.spec.ts`
- Test: `apps/api/src/membership/membership-purchase.service.spec.ts`

**Interfaces:**

- Consumes: Task 1 会员查询契约。
- Produces:
  - `MembershipService.listAdminLevels(query): Promise<AdminMembershipLevelListResult>`
  - `MembershipPurchaseService.listAdmin(query): Promise<AdminMembershipPurchaseListResult>`

- [ ] **Step 1: 写失败测试**

会员卡覆盖 rank、价格、折扣、已售、主题、有效期、更新时间和分页；购卡覆盖用户手机号、等级、履约/支付状态、价格、三组时间范围和 `voidable`。

- [ ] **Step 2: 运行测试确认失败**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api test -- src/membership/membership.service.spec.ts src/membership/membership-purchase.service.spec.ts`

Expected: FAIL，现实现仍为内存过滤且缺高级字段。

- [ ] **Step 3: 实现会员卡 QueryBuilder**

关联购卡表按 level 聚合 `purchaseCount`；`hasPurchases` 使用 `COUNT > 0/=0`；过滤、排序、count 和 `skip/take` 均在数据库执行。

- [ ] **Step 4: 实现购卡 QueryBuilder**

JOIN `users` 过滤手机号；直接过滤订单快照的 `levelId/levelCode/levelName`、支付状态、价格和时间。

`voidable` 先用数据库可判定条件缩小结果：仅 `FULFILLED + SUCCEEDED` 可能为 true；对当前页候选批量加载权益段、消费金和订单使用情况，复用现有作废规则生成最终结果。`voidable=YES/NO` 时在分页前使用等价查询条件或候选 ID 子查询，确保 total 正确，不在分页后过滤。

- [ ] **Step 5: 运行会员测试**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api test -- src/membership/membership.service.spec.ts src/membership/membership-purchase.service.spec.ts`

Expected: PASS。

---

### Task 5: 建立 Admin 共用自适应查询面板与列表工具

**Files:**

- Create: `apps/admin-web/src/components/filters/AdminFilterPanel.vue`
- Create: `apps/admin-web/src/components/filters/AdminFilterPanel.spec.ts`
- Create: `apps/admin-web/src/config/pagination.ts`
- Create: `apps/admin-web/src/utils/list-query.ts`
- Create: `apps/admin-web/src/utils/list-query.spec.ts`
- Modify: `apps/admin-web/src/styles/theme.css`

**Interfaces:**

- Produces:

```ts
type AdminFilterPanelProps = {
  loading?: boolean;
  advancedCount?: number;
};

type AdminFilterPanelEmits = {
  search: [];
  reset: [];
};
```

Slots：`default` 为基础字段，`advanced` 为更多字段。纯函数：

```ts
compactQuery<T extends Record<string, unknown>>(query: T): Partial<T>;
toExclusiveDateRange(range: readonly [string, string] | null): {
  from?: string;
  before?: string;
};
countActiveFilters(value: Record<string, unknown>): number;
```

- [ ] **Step 1: 写组件和纯函数失败测试**

验证：基础 slot 始终显示、更多 slot 展开、badge 数量、search/reset emit、loading 禁用按钮、空字符串/null/undefined 被移除但 `false/0` 保留。

- [ ] **Step 2: 运行测试确认失败**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/admin-web test -- src/components/filters/AdminFilterPanel.spec.ts src/utils/list-query.spec.ts`

Expected: FAIL，文件不存在。

- [ ] **Step 3: 实现组件**

字段网格使用：

```css
.admin-filter-panel__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 14px 16px;
}
```

所有 `el-form-item` margin 归零，表单控件宽度 100%；操作区使用 flex-wrap，与字段网格分离；移除订单/购卡原有 viewport 网格媒体查询。

- [ ] **Step 4: 实现工具与统一分页配置**

导出 `DEFAULT_PAGE_SIZE = 20` 和 `PAGE_SIZE_OPTIONS = [10, 20, 50, 100]`。

- [ ] **Step 5: 运行测试**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/admin-web test -- src/components/filters/AdminFilterPanel.spec.ts src/utils/list-query.spec.ts`

Expected: PASS。

---

### Task 6: 改造分类、商品和 Banner 列表

**Files:**

- Create/Modify: `apps/admin-web/src/views/categories/components/CategoryFilters.vue`
- Create/Modify: `apps/admin-web/src/views/categories/config/defaults.ts`
- Modify: `apps/admin-web/src/views/categories/hooks/useCategories.ts`
- Modify: `apps/admin-web/src/views/categories/api/index.ts`
- Modify: `apps/admin-web/src/views/CategoriesView.vue`
- Modify: `apps/admin-web/src/views/categories/components/CategoryTable.vue`
- Create/Modify: `apps/admin-web/src/views/products/components/ProductFilters.vue`
- Create/Modify: `apps/admin-web/src/views/products/config/defaults.ts`
- Modify: `apps/admin-web/src/views/products/hooks/useProductsList.ts`
- Modify: `apps/admin-web/src/views/products/api/index.ts`
- Modify: `apps/admin-web/src/views/products/ProductsView.vue`
- Modify: `apps/admin-web/src/views/products/components/ProductTable.vue`
- Create/Modify: `apps/admin-web/src/views/banners/components/BannerFilters.vue`
- Create/Modify: `apps/admin-web/src/views/banners/config/defaults.ts`
- Modify: `apps/admin-web/src/views/banners/hooks/useBanners.ts`
- Modify: `apps/admin-web/src/views/banners/api/index.ts`
- Modify: `apps/admin-web/src/views/banners/BannersView.vue`
- Test: 对应现有 view/hook/api/table spec

**Interfaces:**

- Consumes: Tasks 1、2、5。
- Produces: 三页草稿/已应用条件、服务端分页、基础/更多筛选和统一空状态。

- [ ] **Step 1: 扩展 hook/API/View 失败测试**

每页验证首次请求 `{ page:1,pageSize:20 }`、查询复位页码、重置立即刷新、pageSize 复位、旧请求不覆盖新请求，以及 API 只发送非空参数。

- [ ] **Step 2: 运行三域测试确认失败**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/admin-web test -- src/views/categories src/views/products src/views/banners`

Expected: FAIL，分页响应和 filters 尚未接入。

- [ ] **Step 3: 实现分类页面**

新增名称/状态基础字段与图片/关联商品/创建时间高级字段；保留行内编辑，编辑成功后按当前条件刷新；操作列固定右侧。

- [ ] **Step 4: 实现商品页面**

加载分类选项；新增名称/分类/状态基础字段与 SKU、库存、主图、价格、创建时间高级字段；价格输入以元显示，提交前精确转换为整数分；操作列固定右侧。

- [ ] **Step 5: 实现 Banner 页面**

新增标题/状态/跳转类型基础字段与目标/目标有效性/创建时间高级字段；目标选项随类型切换；新增/编辑成功后按当前条件刷新。

- [ ] **Step 6: 运行三域测试**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/admin-web test -- src/views/categories src/views/products src/views/banners`

Expected: PASS。

---

### Task 7: 改造订单、会员卡和购卡记录列表

**Files:**

- Modify: `apps/admin-web/src/views/orders/components/OrderFilters.vue`
- Modify: `apps/admin-web/src/views/orders/config/defaults.ts`
- Modify: `apps/admin-web/src/views/orders/hooks/useOrders.ts`
- Modify: `apps/admin-web/src/views/orders/api/index.ts`
- Modify: `apps/admin-web/src/views/orders/OrdersView.vue`
- Modify: `apps/admin-web/src/views/orders/components/OrderTable.vue`
- Modify: `apps/admin-web/src/views/membership-cards/MembershipCardsView.vue`
- Create/Modify: `apps/admin-web/src/views/membership-cards/components/MembershipCardFilters.vue`
- Modify: `apps/admin-web/src/views/membership-cards/config/defaults.ts`
- Modify: `apps/admin-web/src/views/membership-cards/hooks/useMembershipCards.ts`
- Modify: `apps/admin-web/src/views/membership-cards/api/index.ts`
- Modify: `apps/admin-web/src/views/membership-cards/components/MembershipCardTable.vue`
- Modify: `apps/admin-web/src/views/membership-purchases/components/MembershipPurchaseFilters.vue`
- Modify: `apps/admin-web/src/views/membership-purchases/config/defaults.ts`
- Modify: `apps/admin-web/src/views/membership-purchases/hooks/useMembershipPurchases.ts`
- Modify: `apps/admin-web/src/views/membership-purchases/api/index.ts`
- Modify: `apps/admin-web/src/views/membership-purchases/MembershipPurchasesView.vue`
- Test: 对应现有 view/hook/api/table spec

**Interfaces:**

- Consumes: Tasks 1、3、4、5。
- Produces: 三页完整筛选、统一分页、订单正确应付金额、会员卡单层滚动。

- [ ] **Step 1: 写三域失败测试**

订单验证高级参数与 `payableTotalCents`；会员卡验证重置、分页与高级过滤；购卡验证手机号、可读等级下拉、独立支付状态和三组日期。组件测试验证三页均使用 `AdminFilterPanel`。

- [ ] **Step 2: 运行测试确认失败**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/admin-web test -- src/views/orders src/views/membership-cards src/views/membership-purchases`

Expected: FAIL，新字段和统一面板未接入。

- [ ] **Step 3: 实现订单列表**

基础字段为订单号、联系人/手机号、状态、履约方式；高级字段按规格实现。金额区间精确转换为分。表格只显示 API 的 `payableTotalCents`，不以商品总额静默回退。

- [ ] **Step 4: 实现会员卡列表**

将内联 toolbar 拆为组件；接入分页；移除组件内部 `admin-horizontal-scroll`；降低表格 min-width，压缩预览和操作列。

- [ ] **Step 5: 实现购卡记录列表**

等级下拉从会员卡列表选项加载；使用用户手机号替代手填 userId；支付状态和履约状态分开；修正 `--admin-text-muted` 为 `--admin-muted`。

- [ ] **Step 6: 运行三域测试**

Run: `PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/admin-web test -- src/views/orders src/views/membership-cards src/views/membership-purchases`

Expected: PASS。

---

### Task 8: 全链路验证与运行时验收

**Files:**

- Modify only if verification reveals a regression in files touched by Tasks 1–7.

**Interfaces:**

- Consumes: 所有前置任务。
- Produces: 可验证的 API/Admin 完成状态。

- [ ] **Step 1: 运行包级静态与测试验证**

```bash
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/contracts test
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/contracts typecheck
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api test
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/api typecheck
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/admin-web test
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/admin-web typecheck
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm --filter @bake-mall/admin-web lint
```

Expected: 全部 PASS。

- [ ] **Step 2: 启动真实环境**

加载根 `.env` 并设置 `PORT=3015` 后运行 `pnpm dev`；健康检查 `GET http://127.0.0.1:3015/api/v1/health` 返回 `{"status":"ok"}`。

- [ ] **Step 3: 浏览器验收 6 个页面**

使用隔离 Chrome CDP 会话登录 Admin，逐页执行：基础查询、展开更多、组合查询、重置、分页、pageSize。检查字段自动换行、按钮不挤入字段区、没有双横向滚动、操作列可用。

- [ ] **Step 4: API 运行时抽查**

用真实管理员 token 请求 6 个列表接口，验证 `{items,total,page,pageSize}`、非法参数 400、时间排他上界和订单正确应付金额。

- [ ] **Step 5: 检查工作树**

Run: `git status --short && git diff --check`

Expected: 只有本功能代码、测试、设计规格与计划；无空白错误；不包含 `.DS_Store` 或临时截图。
