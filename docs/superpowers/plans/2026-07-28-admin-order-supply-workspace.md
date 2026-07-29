# 商家后台固定列表工作区与订单供货清单实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让六个商家后台列表页固定在 PC 可视工作区内并由表格内部滚动，同时为订单管理增加订单/SKU 供货双模式及服务端 Excel 导出。

**Architecture:** 先在路由、`AdminLayout`、`AdminPage` 和 `AdminDataPanel` 建立显式的 `workspace/document` 布局边界，再在共享契约与订单项快照中加入稳定 SKU 聚合能力。API 将订单筛选提取成单一查询构造器，订单列表、SKU 汇总、展开明细与 Excel 导出共用口径；Admin 通过拆分后的 hooks 维护双模式、独立分页、懒加载明细和 Blob 下载。

**Tech Stack:** pnpm workspace、TypeScript 5.8、Vue 3、Vite 5、Element Plus、NestJS 11、TypeORM 0.3、MySQL 8.4、ExcelJS、Vitest、Vue Test Utils、真实 Chrome 验收。

**权威规格：** `docs/superpowers/specs/2026-07-28-admin-order-supply-workspace-design.md`

**提交约束：** 当前用户未授权提交或推送；实施过程中不得执行 `git add`、`git commit` 或 `git push`。每个任务以测试通过和 `git diff --check` 作为检查点。

---

## 文件结构与职责

### 共享契约

- `packages/shared-contracts/src/admin-order.ts`：订单共享筛选、两种分页响应、供货分组/明细和导出可辨识联合。
- `packages/shared-contracts/src/enums.ts`：新增导出模式与 `EXPORT_TOO_LARGE` 错误码；供货状态不重复声明 enum，使用 `OrderStatus` 的只读子集。
- `packages/shared-contracts/src/admin-contracts.type-test.ts`：跨应用类型合法/非法形态断言。
- `packages/shared-contracts/src/admin-contracts.spec.ts`：运行时常量与既有契约回归。

### API 数据与查询

- `apps/api/src/database/migrations/0008-order-item-source-ids.ts`：新增可空来源 ID、索引和保守历史回填。
- `apps/api/src/database/migrations/0008-order-item-source-ids.spec.ts`：迁移 SQL、唯一匹配和回滚测试。
- `apps/api/src/database/entities/order-item.entity.ts`：映射 `productId/skuId` 快照列。
- `apps/api/src/database/data-source.ts`：注册 0008 迁移。
- `apps/api/src/orders/dto/admin-order-filter.dto.ts`：共享非状态筛选验证基类。
- `apps/api/src/orders/dto/admin-order-list-query.dto.ts`：订单模式单值状态 + 分页。
- `apps/api/src/orders/dto/admin-order-supply-query.dto.ts`：供货状态数组 + 分页。
- `apps/api/src/orders/dto/admin-order-supply-detail-query.dto.ts`：opaque groupKey + 供货状态 + 明细分页。
- `apps/api/src/orders/dto/admin-order-export-query.dto.ts`：按导出 view 校验状态参数。
- `apps/api/src/orders/admin-order-query.helpers.ts`：规范化筛选、SQL LIKE 转义、供货 group expression 和稳定排序。
- `apps/api/src/orders/admin-order-query.service.ts`：订单分页、SKU 汇总分页和分组明细查询。
- `apps/api/src/orders/admin-order-export.service.ts`：导出上限、事务一致性、Excel 生成、公式注入防护。
- `apps/api/src/orders/admin-orders.controller.ts`：静态路由优先的 list/supply/supply-items/export 端点。
- `apps/api/src/orders/orders.service.ts`：订单创建写入来源 ID；状态流转保持不变。
- `apps/api/src/orders/orders.module.ts`：注册查询与导出服务。

### Admin 固定工作区

- `apps/admin-web/src/router/index.ts`：列表路由声明 `layoutMode: 'workspace'`，编辑/Dashboard 保持 `document`。
- `apps/admin-web/src/layouts/AdminLayout.vue`：根据路由元信息切换固定视口或自然文档布局。
- `apps/admin-web/src/components/layout/AdminPage.vue`：`workspace` prop 建立 `auto/minmax(0,1fr)` 页面轨道。
- `apps/admin-web/src/components/layout/AdminDataPanel.vue`：`fill` prop 建立 toolbar/data/footer 三行布局。
- 六个列表 View：传入 `workspace` / `fill`。
- 六个列表 Table：Element Plus 表格使用 `height="100%"`，删除重复横向滚动责任。

### Admin 订单双模式

- `apps/admin-web/src/api/http.ts`：全局鉴权 Blob 下载和文件名解析。
- `apps/admin-web/src/views/orders/api/index.ts`：订单、供货汇总、分组明细和导出端点。
- `apps/admin-web/src/views/orders/hooks/order-query.ts`：筛选表单到共享查询的纯函数。
- `apps/admin-web/src/views/orders/hooks/useOrderFilters.ts`：草稿/已应用筛选。
- `apps/admin-web/src/views/orders/hooks/useOrderList.ts`：订单列表、详情和状态流转。
- `apps/admin-web/src/views/orders/hooks/useOrderSupply.ts`：供货分页、展开明细缓存和竞态保护。
- `apps/admin-web/src/views/orders/hooks/useOrderExport.ts`：导出 loading、下载和错误。
- `apps/admin-web/src/views/orders/hooks/useOrderWorkspace.ts`：组合双模式并协调 search/reset/mode/page。
- `apps/admin-web/src/views/orders/components/OrderModeSwitch.vue`：模式切换和导出按钮。
- `apps/admin-web/src/views/orders/components/OrderSupplyTable.vue`：SKU 汇总及展开入口。
- `apps/admin-web/src/views/orders/components/OrderSupplyDetail.vue`：分组订单项明细、分页/重试。
- `apps/admin-web/src/views/orders/OrdersView.vue`：纯组装页面。

---

### 任务 1：定义订单供货与导出共享契约

**Files:**

- Modify: `packages/shared-contracts/src/admin-order.ts`
- Modify: `packages/shared-contracts/src/enums.ts`
- Modify: `packages/shared-contracts/src/admin-contracts.type-test.ts`
- Modify: `packages/shared-contracts/src/admin-contracts.spec.ts`

- [ ] **步骤 1：先写失败的类型级断言**

在 `admin-contracts.type-test.ts` 增加：

```ts
import {
  AdminOrderExportView,
  OrderStatus,
  type AdminOrderExportQuery,
  type AdminOrderSupplyQuery,
} from './index.js';

const validSupply: AdminOrderSupplyQuery = {
  supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
  page: 1,
  pageSize: 20,
};

const validSupplyExport: AdminOrderExportQuery = {
  view: AdminOrderExportView.SUPPLY,
  supplyStatuses: [OrderStatus.NEW],
};

// @ts-expect-error supply view 必须显式携带供货状态
const missingSupplyStatuses: AdminOrderExportQuery = {
  view: AdminOrderExportView.SUPPLY,
};

// @ts-expect-error 订单导出不能携带供货状态
const invalidOrderExport: AdminOrderExportQuery = {
  view: AdminOrderExportView.ORDER,
  supplyStatuses: [OrderStatus.NEW],
};

void [
  validSupply,
  validSupplyExport,
  missingSupplyStatuses,
  invalidOrderExport,
];
```

- [ ] **步骤 2：运行契约 typecheck，确认先失败**

Run:

```bash
pnpm --filter @bake-mall/contracts typecheck
```

Expected: FAIL，报告 `AdminOrderExportView`、`AdminOrderSupplyQuery` 等尚未导出。

- [ ] **步骤 3：实现最小共享契约**

在 `enums.ts` 增加：

```ts
export enum AdminOrderExportView {
  ORDER = 'ORDER',
  SUPPLY = 'SUPPLY',
}

export enum AdminOrderSupplyMatchType {
  SKU_ID = 'SKU_ID',
  LEGACY_FALLBACK = 'LEGACY_FALLBACK',
}

export enum ApiErrorCode {
  // 保留既有成员
  EXPORT_TOO_LARGE = 'EXPORT_TOO_LARGE',
}
```

在 `admin-order.ts` 定义：

```ts
export const SUPPLY_ORDER_STATUSES = [
  OrderStatus.NEW,
  OrderStatus.PROCESSING,
] as const;

export type SupplyOrderStatus = (typeof SUPPLY_ORDER_STATUSES)[number];

export type AdminOrderFilterQuery = CreatedAtRangeQuery & {
  orderNo?: string;
  contact?: string;
  fulfillmentType?: FulfillmentType;
  userId?: string;
  itemQ?: string;
  usesMembership?: BooleanFilter;
  usesCredit?: BooleanFilter;
  hasRemark?: BooleanFilter;
  minPayableCents?: number;
  maxPayableCents?: number;
};

export type AdminOrderListQuery = AdminOrderFilterQuery &
  AdminPageQuery & { status?: OrderStatus };

export type AdminOrderSupplyQuery = AdminOrderFilterQuery &
  AdminPageQuery & { supplyStatuses: readonly SupplyOrderStatus[] };

export type AdminOrderSupplyDetailQuery = AdminOrderFilterQuery &
  AdminPageQuery & {
    groupKey: string;
    supplyStatuses: readonly SupplyOrderStatus[];
  };

export type AdminOrderExportQuery =
  | (AdminOrderFilterQuery & {
      view: AdminOrderExportView.ORDER;
      status?: OrderStatus;
    })
  | (AdminOrderFilterQuery & {
      view: AdminOrderExportView.SUPPLY;
      supplyStatuses: readonly SupplyOrderStatus[];
    });
```

扩展 `AdminOrderListItem`，将三个金额字段改为必填，并加入：

```ts
userId: string;
itemLineCount: number;
totalQuantity: number;
pickupTimeText?: string;
deliveryAddressText?: string;
membershipCode?: string;
membershipName?: string;
membershipDiscountBasisPoints?: number;
remark?: string;
```

新增：

```ts
export type AdminOrderSupplyItem = {
  groupKey: string;
  matchType: AdminOrderSupplyMatchType;
  productId?: string;
  skuId?: string;
  productName: string;
  skuName: string;
  skuAttributes: Readonly<Record<string, string>>;
  requiredQuantity: number;
  orderCount: number;
  newQuantity: number;
  processingQuantity: number;
  remainingSaleableStock?: number;
  earliestOrderCreatedAt: string;
};

export type AdminOrderSupplyDetailItem = {
  orderItemId: string;
  orderId: string;
  orderNo: string;
  status: SupplyOrderStatus;
  fulfillmentType: FulfillmentType;
  contactName: string;
  contactPhone: string;
  pickupTimeText?: string;
  deliveryAddressText?: string;
  productId?: string;
  skuId?: string;
  productName: string;
  skuName: string;
  skuAttributes: Readonly<Record<string, string>>;
  quantity: number;
  unitPriceCents: number;
  lineGoodsTotalCents: number;
  lineMembershipDiscountCents: number;
  linePayableCents: number;
  remark?: string;
  orderCreatedAt: string;
};

export type AdminOrderSupplyResult = PaginatedView<AdminOrderSupplyItem>;
export type AdminOrderSupplyDetailResult =
  PaginatedView<AdminOrderSupplyDetailItem>;
```

- [ ] **步骤 4：运行契约测试并修正类型一致性**

Run:

```bash
pnpm --filter @bake-mall/contracts test && \
pnpm --filter @bake-mall/contracts typecheck && \
pnpm --filter @bake-mall/contracts build
```

Expected: PASS，且 `dist/admin-order.d.ts` 导出两种可辨识导出查询。

- [ ] **步骤 5：检查本任务差异**

Run:

```bash
git diff --check -- packages/shared-contracts
```

Expected: exit 0。

---

### 任务 2：迁移订单项来源 ID 并在新订单中写入

**Files:**

- Create: `apps/api/src/database/migrations/0008-order-item-source-ids.ts`
- Create: `apps/api/src/database/migrations/0008-order-item-source-ids.spec.ts`
- Modify: `apps/api/src/database/entities/order-item.entity.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/orders/orders.service.spec.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Modify: `apps/api/test/orders.e2e-spec.ts`

- [ ] **步骤 1：写迁移和订单创建失败测试**

迁移测试断言：

```ts
expect(query).toHaveBeenCalledWith(
  expect.stringContaining('ADD COLUMN `product_id` BIGINT UNSIGNED NULL'),
);
expect(query).toHaveBeenCalledWith(
  expect.stringContaining('ADD COLUMN `sku_id` BIGINT UNSIGNED NULL'),
);
expect(query).toHaveBeenCalledWith(
  expect.stringContaining('HAVING COUNT(*) = 1'),
);
expect(query).toHaveBeenCalledWith(
  expect.stringContaining('DROP INDEX `idx_order_items_sku`'),
);
```

在 `orders.service.spec.ts` 的创建成功用例中断言保存的订单项包含：

```ts
expect(orderItemRepo.create).toHaveBeenCalledWith(
  expect.objectContaining({
    productId: 'product-1',
    skuId: 'sku-1',
    productName: '草莓蛋糕',
    skuName: '6寸',
  }),
);
```

- [ ] **步骤 2：运行定向测试确认失败**

Run:

```bash
pnpm --filter @bake-mall/api test -- \
src/database/migrations/0008-order-item-source-ids.spec.ts \
src/orders/orders.service.spec.ts
```

Expected: FAIL，迁移不存在且订单项没有来源 ID。

- [ ] **步骤 3：实现 0008 迁移**

迁移 `up` 依次执行：

```sql
ALTER TABLE `order_items`
  ADD COLUMN `product_id` BIGINT UNSIGNED NULL AFTER `order_id`,
  ADD COLUMN `sku_id` BIGINT UNSIGNED NULL AFTER `product_id`;

CREATE INDEX `idx_order_items_product` ON `order_items` (`product_id`);
CREATE INDEX `idx_order_items_sku` ON `order_items` (`sku_id`);
```

用唯一候选派生表保守回填：

```sql
UPDATE `order_items` item
INNER JOIN (
  SELECT
    source.`id` AS `order_item_id`,
    MIN(sku.`product_id`) AS `product_id`,
    MIN(sku.`id`) AS `sku_id`
  FROM `order_items` source
  INNER JOIN `products` product
    ON product.`name` = source.`product_name`
  INNER JOIN `skus` sku
    ON sku.`product_id` = product.`id`
   AND sku.`name` = source.`sku_name`
   AND CAST(sku.`attributes` AS CHAR) = CAST(source.`sku_attributes` AS CHAR)
  GROUP BY source.`id`
  HAVING COUNT(*) = 1
) matched ON matched.`order_item_id` = item.`id`
SET item.`product_id` = matched.`product_id`,
    item.`sku_id` = matched.`sku_id`;
```

`down` 先删除两个索引，再删除两列。不要添加外键，避免实时商品删除改写历史订单语义。

- [ ] **步骤 4：注册实体字段和迁移**

`OrderItem` 增加：

```ts
@Column({ name: 'product_id', type: 'bigint', unsigned: true, nullable: true })
productId!: string | null;

@Column({ name: 'sku_id', type: 'bigint', unsigned: true, nullable: true })
skuId!: string | null;
```

在 `data-source.ts` 注册 `OrderItemSourceIds1718000000007`。

- [ ] **步骤 5：订单创建写入来源 ID**

将订单项快照创建改为：

```ts
return orderItemRepo.create({
  productId: product.id,
  skuId: sku.id,
  productName: product.name,
  skuName: sku.name,
  skuAttributes: sku.attributes,
  imageUrl: sku.imageUrl ?? null,
  unitPriceCents: sku.priceCents,
  quantity: cartItem.quantity,
});
```

保持库存条件扣减、幂等记录和订单快照其他字段不变。

- [ ] **步骤 6：运行迁移、订单单元和 e2e 测试**

Run:

```bash
pnpm --filter @bake-mall/api test -- \
src/database/migrations/0008-order-item-source-ids.spec.ts \
src/orders/orders.service.spec.ts && \
pnpm --filter @bake-mall/api test:e2e -- orders.e2e-spec.ts
```

Expected: PASS；订单创建返回不变，数据库订单项包含来源 ID。

---

### 任务 3：抽取统一后台订单筛选和 DTO 验证

**Files:**

- Create: `apps/api/src/orders/dto/admin-order-filter.dto.ts`
- Modify: `apps/api/src/orders/dto/admin-order-list-query.dto.ts`
- Create: `apps/api/src/orders/dto/admin-order-supply-query.dto.ts`
- Create: `apps/api/src/orders/dto/admin-order-supply-detail-query.dto.ts`
- Create: `apps/api/src/orders/dto/admin-order-export-query.dto.ts`
- Create: `apps/api/src/orders/dto/admin-order-report-query.dto.spec.ts`
- Create: `apps/api/src/orders/admin-order-query.helpers.ts`
- Create: `apps/api/src/orders/admin-order-query.helpers.spec.ts`
- Modify: `apps/api/src/orders/orders.service.ts`

- [ ] **步骤 1：写 DTO 和纯筛选失败测试**

覆盖：

```ts
expect(validateSupply({ supplyStatuses: ['NEW', 'PROCESSING'] })).toEqual([]);
expect(validateSupply({ supplyStatuses: [] })).toContainEqual(
  expect.objectContaining({ property: 'supplyStatuses' }),
);
expect(validateSupply({ supplyStatuses: ['COMPLETED'] })).toContainEqual(
  expect.objectContaining({ property: 'supplyStatuses' }),
);
expect(validateExport({ view: 'SUPPLY', supplyStatuses: ['NEW'] })).toEqual([]);
expect(validateExport({ view: 'SUPPLY' })).not.toEqual([]);
```

并对 `applyAdminOrderFilters` 的 LIKE 转义、金额、时间和 itemQ 语义写 QueryBuilder mock 断言。

- [ ] **步骤 2：运行测试确认失败**

Run:

```bash
pnpm --filter @bake-mall/api test -- \
src/orders/dto/admin-order-report-query.dto.spec.ts \
src/orders/admin-order-query.helpers.spec.ts
```

Expected: FAIL，DTO 和 helper 尚不存在。

- [ ] **步骤 3：实现 DTO 基类和状态数组转换**

`AdminOrderFilterDto` 承载现有非状态字段和装饰器。供货状态使用：

```ts
const toArray = ({ value }: TransformFnParams): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

@Transform(toArray)
@IsArray()
@ArrayMinSize(1)
@ArrayMaxSize(2)
@ArrayUnique()
@IsIn(SUPPLY_ORDER_STATUSES, { each: true })
supplyStatuses!: SupplyOrderStatus[];
```

URL 使用重复参数：

```text
supplyStatuses=NEW&supplyStatuses=PROCESSING
```

导出 DTO 使用自定义 class-validator 约束或 `ValidateIf`：`ORDER` 接受可选单值 `status` 且拒绝 `supplyStatuses`；`SUPPLY` 必须有合法 `supplyStatuses` 且拒绝 `status`。

- [ ] **步骤 4：实现共享 QueryBuilder helper**

提供明确的两个入口：

```ts
export function applyOrderHeaderFilters(
  builder: SelectQueryBuilder<Order>,
  query: AdminOrderFilterQuery,
): SelectQueryBuilder<Order>;

export function applyOrderItemFilters<T>(
  builder: SelectQueryBuilder<T>,
  query: AdminOrderFilterQuery,
  aliases: { order: string; item: string },
): SelectQueryBuilder<T>;
```

订单列表 `itemQ` 使用 `EXISTS`；供货查询直接过滤当前 item 的商品名/SKU 名。两者共用其他订单头条件。

供货 group expression 集中定义：

```ts
export const SUPPLY_GROUP_KEY_SQL = `CASE
  WHEN item.sku_id IS NOT NULL THEN CONCAT('sku:', item.sku_id)
  ELSE CONCAT(
    'legacy:',
    SHA2(CONCAT_WS(CHAR(0), item.product_name, item.sku_name,
      CAST(item.sku_attributes AS CHAR)), 256)
  )
END`;
```

- [ ] **步骤 5：让现有订单列表改用 helper**

替换 `OrdersService.listAll` 内重复筛选代码，但保持响应和排序不变；先不加入供货功能。

- [ ] **步骤 6：验证无行为回归**

Run:

```bash
pnpm --filter @bake-mall/api test -- \
src/orders/admin-order-query.helpers.spec.ts \
src/orders/orders.service.spec.ts \
src/orders/dto/admin-order-list-query.dto.spec.ts \
src/orders/dto/admin-order-report-query.dto.spec.ts
```

Expected: PASS，现有订单筛选测试继续通过。

---

### 任务 4：实现订单统计字段、SKU 汇总和展开明细

**Files:**

- Create: `apps/api/src/orders/admin-order-query.service.ts`
- Create: `apps/api/src/orders/admin-order-query.service.spec.ts`
- Modify: `apps/api/src/orders/orders.module.ts`
- Modify: `apps/api/src/orders/orders.service.ts`
- Create: `apps/api/test/admin-order-supply.e2e-spec.ts`

- [ ] **步骤 1：写查询服务失败测试**

使用 QueryBuilder mock 和 MySQL e2e fixture 覆盖：

```ts
expect(result.items[0]).toMatchObject({
  groupKey: 'sku:11',
  skuId: '11',
  requiredQuantity: 18,
  orderCount: 12,
  newQuantity: 10,
  processingQuantity: 8,
  matchType: AdminOrderSupplyMatchType.SKU_ID,
});
```

并验证：

- 同名不同 `skuId` 是两个分组；
- 空 ID 使用 `legacy:<sha256>`；
- `COMPLETED/CANCELLED` 不可进入服务；
- itemQ 只过滤当前 SKU 行；
- 展开明细只返回目标 groupKey；
- 汇总排序为数量降序、最早下单升序、groupKey 升序。

- [ ] **步骤 2：运行定向测试确认失败**

Run:

```bash
pnpm --filter @bake-mall/api test -- \
src/orders/admin-order-query.service.spec.ts && \
pnpm --filter @bake-mall/api test:e2e -- admin-order-supply.e2e-spec.ts
```

Expected: FAIL，服务不存在。

- [ ] **步骤 3：实现订单模式统计字段**

查询订单页时通过按 `order_id` 聚合的子查询加入：

```sql
COUNT(item.id) AS itemLineCount,
COALESCE(SUM(item.quantity), 0) AS totalQuantity
```

不要直接对 join 后结果调用不稳定的 offset 分页；先分页订单 ID，再关联聚合结果，或使用相关子查询。`AdminOrderListItem` 映射所有金额为必填，并补充用户、履约、会员和备注快照字段。

- [ ] **步骤 4：实现 SKU 汇总数据库分页**

`AdminOrderQueryService.listSupply(query)`：

1. 从 `order_items item` join `orders order`。
2. 强制 `order.status IN (:...supplyStatuses)`。
3. 应用 item 语义筛选。
4. 按 `SUPPLY_GROUP_KEY_SQL` 和不可变显示快照分组。
5. 聚合 `SUM(quantity)`、`COUNT(DISTINCT order.id)`、按状态 SUM、`MIN(order.created_at)`。
6. left join 实时 `skus` 读取参考库存；legacy 行返回空。
7. 使用独立 count 子查询计算分组总数。
8. 在 SQL 中排序和分页。

所有 MySQL `BIGINT`、`COUNT`、`SUM` 原始字符串通过集中 helper 转成安全整数；超出 `Number.MAX_SAFE_INTEGER` 时抛出明确错误，不静默截断。

- [ ] **步骤 5：实现分组明细分页**

`listSupplyItems(query)` 重新计算 groupKey 并精确匹配参数，不把 groupKey 解析成 SQL 片段。返回 `PaginatedView`，默认 50、最大 100，按 `order.created_at ASC, order.id ASC, item.id ASC`。

- [ ] **步骤 6：注册服务并运行测试**

Run:

```bash
pnpm --filter @bake-mall/api test -- \
src/orders/admin-order-query.service.spec.ts \
src/orders/orders.service.spec.ts && \
pnpm --filter @bake-mall/api test:e2e -- admin-order-supply.e2e-spec.ts
```

Expected: PASS，测试数据聚合数量与 SQL 结果一致。

---

### 任务 5：实现安全且一致的服务端 Excel 导出

**Files:**

- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/api/src/orders/admin-order-export.service.ts`
- Create: `apps/api/src/orders/admin-order-export.service.spec.ts`
- Modify: `apps/api/src/orders/orders.module.ts`
- Modify: `packages/shared-contracts/src/enums.ts`

- [ ] **步骤 1：安装 ExcelJS**

Run:

```bash
pnpm --filter @bake-mall/api add exceljs
```

Expected: `apps/api/package.json` 与 `pnpm-lock.yaml` 更新，安装成功。

- [ ] **步骤 2：写 Excel 失败测试**

测试先构造小型订单/供货数据，并使用 ExcelJS 重新读取 buffer：

```ts
const workbook = new Workbook();
await workbook.xlsx.load(result.buffer);
expect(workbook.worksheets.map(({ name }) => name)).toEqual([
  'SKU 供货汇总',
  '订单商品明细',
]);
expect(workbook.getWorksheet('订单商品明细')?.rowCount).toBe(3);
expect(
  workbook.getWorksheet('订单商品明细')?.getCell('A2').formula,
).toBeUndefined();
```

覆盖：

- 订单模式一个 Sheet；
- 供货模式双 Sheet；
- 金额写入 number 且 `numFmt = '¥#,##0.00'`；
- ID/手机号写文本；
- `=HYPERLINK(...)`、`+1`、`-1`、`@SUM` 不成为公式；
- 50,001 行抛出 `EXPORT_TOO_LARGE`；
- 文件名不含个人信息。

- [ ] **步骤 3：运行测试确认失败**

Run:

```bash
pnpm --filter @bake-mall/api test -- \
src/orders/admin-order-export.service.spec.ts
```

Expected: FAIL，导出服务不存在。

- [ ] **步骤 4：实现 Excel 安全 helper**

```ts
const EXCEL_FORMULA_PREFIX = /^[=+\-@]/;
const MAX_EXCEL_TEXT_LENGTH = 32_767;

export function safeExcelText(value: string | null | undefined): string {
  const limited = (value ?? '').slice(0, MAX_EXCEL_TEXT_LENGTH);
  return EXCEL_FORMULA_PREFIX.test(limited) ? `'${limited}` : limited;
}

export const centsToExcelYuan = (cents: number): number => cents / 100;
```

只给 cell 设置字符串或数值，不创建 `{ formula }` 对象。标题行冻结，启用自动筛选，金额列设置 numFmt，ID/手机号列设置文本格式。

- [ ] **步骤 5：实现导出事务与上限**

`AdminOrderExportService.export(query)` 返回：

```ts
type AdminOrderExportFile = {
  buffer: Buffer;
  filename: string;
  rowCount: number;
};
```

使用 `dataSource.transaction('REPEATABLE READ', async (manager) => ...)`：

- 订单模式先 count；超过 50,000 抛 `UnprocessableEntityException({ code: EXPORT_TOO_LARGE, details: { limit: 50000, rowCount } })`。
- 供货模式先 count 明细；汇总与明细都使用同一 manager 和一致性视图；汇总 Sheet 从同批查询结果派生或在同一事务内查询。
- `await workbook.xlsx.writeBuffer()` 后转为 Node `Buffer`。

- [ ] **步骤 6：运行测试和 API typecheck**

Run:

```bash
pnpm --filter @bake-mall/api test -- \
src/orders/admin-order-export.service.spec.ts && \
pnpm --filter @bake-mall/api typecheck
```

Expected: PASS，无 CommonJS/ExcelJS 导入类型错误。

---

### 任务 6：接入供货与导出控制器、鉴权和审计

**Files:**

- Modify: `apps/api/src/orders/admin-orders.controller.ts`
- Modify: `apps/api/src/orders/orders.module.ts`
- Modify: `apps/api/src/audit/audit.service.spec.ts`
- Create: `apps/api/test/admin-order-export.e2e-spec.ts`

- [ ] **步骤 1：写路由、鉴权和响应失败测试**

E2E 覆盖：

```ts
await request(app.getHttpServer())
  .get('/api/v1/admin/orders/supply')
  .query({ supplyStatuses: ['NEW', 'PROCESSING'], page: 1, pageSize: 20 })
  .set('Authorization', `Bearer ${adminToken}`)
  .expect(200);

await request(app.getHttpServer())
  .get('/api/v1/admin/orders/export')
  .query({ view: 'ORDER' })
  .set('Authorization', `Bearer ${adminToken}`)
  .expect('content-type', /spreadsheetml/)
  .expect('content-disposition', /filename\*=UTF-8''/)
  .expect(200);
```

还要断言 mall-user token 得 401，`/orders/supply` 没被 `:id` 路由吞掉，超限得 422 与 `EXPORT_TOO_LARGE`。

- [ ] **步骤 2：运行 E2E 确认失败**

Run:

```bash
pnpm --filter @bake-mall/api test:e2e -- admin-order-export.e2e-spec.ts
```

Expected: FAIL，路由尚不存在。

- [ ] **步骤 3：按静态路由优先顺序实现控制器**

控制器方法顺序：

```ts
@Get()
list(...)

@Get('supply')
listSupply(...)

@Get('supply-items')
listSupplyItems(...)

@Get('export')
async exportOrders(
  @CurrentAdmin() admin: AuthenticatedAdmin,
  @Query() query: AdminOrderExportQueryDto,
  @Res({ passthrough: true }) response: Response,
): Promise<StreamableFile>

@Get(':id')
getOne(...)
```

导出成功前调用审计：

```ts
await this.audit.record({
  adminUserId: admin.id,
  targetEntity: 'ORDER_EXPORT',
  targetId: query.view,
  action: 'EXPORT',
  changeSummary: {
    view: query.view,
    filters: summarizeOrderFilters(query),
    rowCount: file.rowCount,
  },
});
```

审计摘要对 contact 只记录“是否存在”，不写手机号、地址或完整关键词。

- [ ] **步骤 4：设置文件响应**

```ts
response.setHeader(
  'Content-Type',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
);
response.setHeader(
  'Content-Disposition',
  `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
);
return new StreamableFile(file.buffer);
```

- [ ] **步骤 5：运行订单 API 全部定向验证**

Run:

```bash
pnpm --filter @bake-mall/api test -- \
src/orders src/audit/audit.service.spec.ts && \
pnpm --filter @bake-mall/api test:e2e -- \
admin-order-supply.e2e-spec.ts admin-order-export.e2e-spec.ts orders.e2e-spec.ts
```

Expected: PASS，导出二进制可被 ExcelJS 重新打开。

---

### 任务 7：为 Admin 全局客户端增加 Blob 下载

**Files:**

- Modify: `apps/admin-web/src/api/http.ts`
- Modify: `apps/admin-web/src/api/http.spec.ts`
- Create: `apps/admin-web/src/utils/download.ts`
- Create: `apps/admin-web/src/utils/download.spec.ts`

- [ ] **步骤 1：写失败测试**

覆盖：

```ts
const file = await client.getBlob('/admin/orders/export?view=ORDER');
expect(file.blob.type).toContain('spreadsheetml');
expect(file.filename).toBe('订单列表_20260728_093000.xlsx');
expect(fetch).toHaveBeenCalledWith(
  '/api/v1/admin/orders/export?view=ORDER',
  expect.objectContaining({ headers: expect.any(Headers) }),
);
```

还要覆盖 UTF-8 `filename*`、普通 `filename`、缺失文件名的安全默认名、401 handler、非 2xx JSON `ApiError`。

- [ ] **步骤 2：运行测试确认失败**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- \
src/api/http.spec.ts src/utils/download.spec.ts
```

Expected: FAIL，`getBlob` 和下载 helper 不存在。

- [ ] **步骤 3：抽取统一 fetch/error 路径并实现 getBlob**

保持 JSON request 行为不变，新增：

```ts
export type DownloadedBlob = {
  blob: Blob;
  filename?: string;
};

async getBlob(path: string, init?: ApiRequestInit): Promise<DownloadedBlob> {
  const response = await this.fetchResponse(path, { ...init, method: 'GET' });
  return {
    blob: await response.blob(),
    filename: parseContentDispositionFilename(
      response.headers.get('content-disposition'),
    ),
  };
}
```

`fetchResponse` 统一处理 Authorization、网络错误、401 和非 2xx，不复制逻辑。

- [ ] **步骤 4：实现浏览器保存 helper**

```ts
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
```

文件名为空时由调用方提供 `订单导出.xlsx`，不得从 URL 或用户输入拼接。

- [ ] **步骤 5：运行测试和 typecheck**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- \
src/api/http.spec.ts src/utils/download.spec.ts && \
pnpm --filter @bake-mall/admin-web typecheck
```

Expected: PASS。

---

### 任务 8：建立路由驱动的固定列表工作区

**Files:**

- Modify: `apps/admin-web/src/router/index.ts`
- Modify: `apps/admin-web/src/router/index.spec.ts`
- Modify: `apps/admin-web/src/layouts/AdminLayout.vue`
- Modify: `apps/admin-web/src/layouts/AdminLayout.spec.ts`
- Modify: `apps/admin-web/src/components/layout/AdminPage.vue`
- Modify: `apps/admin-web/src/components/layout/AdminDataPanel.vue`
- Modify: `apps/admin-web/src/components/layout/AdminVisualShell.spec.ts`

- [ ] **步骤 1：写布局模式失败测试**

路由测试：

```ts
expect(router.resolve('/orders').meta.layoutMode).toBe('workspace');
expect(router.resolve('/products/new').meta.layoutMode).toBe('document');
expect(router.resolve('/dashboard').meta.layoutMode).toBe('document');
```

组件测试：

```ts
expect(
  mount(AdminPage, { props: { workspace: true } })
    .get('.admin-page')
    .classes(),
).toContain('admin-page--workspace');
expect(
  mount(AdminDataPanel, { props: { fill: true } })
    .get('.admin-data-panel')
    .classes(),
).toContain('admin-data-panel--fill');
```

- [ ] **步骤 2：运行测试确认失败**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- \
src/router/index.spec.ts src/layouts/AdminLayout.spec.ts \
src/components/layout/AdminVisualShell.spec.ts
```

Expected: FAIL，meta 与 props 不存在。

- [ ] **步骤 3：声明路由元信息**

扩展：

```ts
interface RouteMeta {
  requiresAdminAuth?: boolean;
  title?: string;
  layoutMode?: 'workspace' | 'document';
}
```

给六个列表路由设置 `layoutMode: 'workspace'`；Dashboard、编辑页、404 不设置或显式 `document`。

- [ ] **步骤 4：实现 AdminLayout 高度链**

脚本：

```ts
const layoutMode = computed(() => route.meta.layoutMode ?? 'document');
```

根节点 class：

```vue
<div class="admin-layout" :class="`admin-layout--${layoutMode}`">
```

核心 CSS：

```css
.admin-layout--workspace {
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}

.admin-layout--workspace .admin-layout__main {
  display: grid;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}

.admin-layout--workspace .admin-layout__canvas,
.admin-layout--workspace .admin-layout__content {
  min-height: 0;
  overflow: hidden;
}

.admin-layout--workspace .admin-layout__content {
  height: 100%;
}
```

`document` 模式保留现有 `min-height: 100vh` 与自然滚动。窄屏 warning 仍占独立 grid track。

- [ ] **步骤 5：实现 AdminPage/AdminDataPanel opt-in**

```ts
withDefaults(defineProps<{ workspace?: boolean }>(), { workspace: false });
withDefaults(defineProps<{ fill?: boolean }>(), { fill: false });
```

```css
.admin-page--workspace {
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.admin-data-panel--fill {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.admin-data-panel--fill .admin-data-panel__data {
  min-height: 0;
  overflow: hidden;
}
```

错误 Alert 作为 `AdminPage` 的 auto 行时，使用可选 `alerts` slot 或将 workspace 页面结构显式定义为 `auto auto minmax(0,1fr)`，确保 Alert 出现后数据面板仍接收剩余高度。

- [ ] **步骤 6：运行布局单元测试**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- \
src/router/index.spec.ts src/layouts/AdminLayout.spec.ts \
src/components/layout/AdminVisualShell.spec.ts
```

Expected: PASS。

---

### 任务 9：让六个列表页与表格填满工作区

**Files:**

- Modify: `apps/admin-web/src/views/CategoriesView.vue`
- Modify: `apps/admin-web/src/views/products/ProductsView.vue`
- Modify: `apps/admin-web/src/views/banners/BannersView.vue`
- Modify: `apps/admin-web/src/views/orders/OrdersView.vue`
- Modify: `apps/admin-web/src/views/membership-cards/MembershipCardsView.vue`
- Modify: `apps/admin-web/src/views/membership-purchases/MembershipPurchasesView.vue`
- Modify: six corresponding table components
- Modify: relevant `*.spec.ts`

- [ ] **步骤 1：写六页结构失败测试**

用 `it.each` 断言每个列表页传入：

```ts
expect(wrapper.getComponent(AdminPage).props('workspace')).toBe(true);
expect(wrapper.getComponent(AdminDataPanel).props('fill')).toBe(true);
```

并断言各表格的 `ElTable` `height` 为 `100%`。

- [ ] **步骤 2：运行列表页测试确认失败**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- \
src/components/layout/AdminVisualShell.spec.ts \
src/views/CategoriesView.spec.ts \
src/views/products/ProductsView.spec.ts \
src/views/banners/BannersView.spec.ts \
src/views/orders/OrdersView.spec.ts \
src/views/membership-cards/MembershipCardsView.spec.ts \
src/views/membership-purchases/MembershipPurchasesView.spec.ts
```

Expected: FAIL，页面尚未 opt-in。

- [ ] **步骤 3：六页启用 workspace/fill**

统一改为：

```vue
<AdminPage workspace>
  <AdminPageHeader ... />
  <ElAlert v-if="lastError" ... />
  <AdminDataPanel fill>
    ...
  </AdminDataPanel>
</AdminPage>
```

确保分页 footer 即使空结果也占稳定区域；无数据时可隐藏分页按钮，但数据区域不能塌缩。

- [ ] **步骤 4：六个 ElTable 启用内部滚动**

```vue
<ElTable height="100%" class="admin-table" ... />
```

每个 table wrapper 加 `height: 100%; min-height: 0`。移除工作区数据区的 `.admin-horizontal-scroll` class，避免 Element Plus body wrapper 外再出现横向滚动；非 fill 模式保留该工具。

- [ ] **步骤 5：运行六页定向测试和 typecheck**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- \
src/components/layout src/layouts src/router \
src/views/CategoriesView.spec.ts \
src/views/products/ProductsView.spec.ts \
src/views/banners/BannersView.spec.ts \
src/views/orders/OrdersView.spec.ts \
src/views/membership-cards/MembershipCardsView.spec.ts \
src/views/membership-purchases/MembershipPurchasesView.spec.ts && \
pnpm --filter @bake-mall/admin-web typecheck
```

Expected: PASS。

---

### 任务 10：实现 Admin 订单双模式状态、API 和导出 hook

**Files:**

- Modify: `apps/admin-web/src/views/orders/api/index.ts`
- Create: `apps/admin-web/src/views/orders/hooks/order-query.ts`
- Create: `apps/admin-web/src/views/orders/hooks/order-query.spec.ts`
- Create: `apps/admin-web/src/views/orders/hooks/useOrderFilters.ts`
- Create: `apps/admin-web/src/views/orders/hooks/useOrderList.ts`
- Create: `apps/admin-web/src/views/orders/hooks/useOrderSupply.ts`
- Create: `apps/admin-web/src/views/orders/hooks/useOrderSupply.spec.ts`
- Create: `apps/admin-web/src/views/orders/hooks/useOrderExport.ts`
- Create: `apps/admin-web/src/views/orders/hooks/useOrderExport.spec.ts`
- Create: `apps/admin-web/src/views/orders/hooks/useOrderWorkspace.ts`
- Modify/Delete: `apps/admin-web/src/views/orders/hooks/useOrders.ts`
- Modify: `apps/admin-web/src/views/orders/type/index.ts`
- Modify: `apps/admin-web/src/views/orders/config/defaults.ts`

- [ ] **步骤 1：写纯查询转换失败测试**

```ts
expect(
  toSupplyQuery(
    appliedFilters,
    [OrderStatus.NEW, OrderStatus.PROCESSING],
    2,
    50,
  ),
).toEqual(
  expect.objectContaining({
    supplyStatuses: [OrderStatus.NEW, OrderStatus.PROCESSING],
    page: 2,
    pageSize: 50,
  }),
);

expect(toOrderExportQuery(appliedFilters)).not.toHaveProperty('page');
expect(
  toSupplyExportQuery(appliedFilters, [OrderStatus.NEW]),
).not.toHaveProperty('page');
```

测试 URLSearchParams 对数组生成两个 `supplyStatuses`。

- [ ] **步骤 2：写供货和导出 hook 失败测试**

覆盖：

- 默认供货状态 `[NEW, PROCESSING]`；
- 订单与供货模式各自保留 page；
- 模式切换加载目标模式但不导出；
- search 使用草稿更新 applied 后把活动模式页码归 1；
- reset 恢复默认状态；
- 展开同一 groupKey 不重复加载；筛选改变清空明细缓存；
- 旧请求不覆盖新请求；
- 导出只用 appliedFilters；
- 导出 loading 防重复点击；
- Blob 文件名缺失时使用安全中文默认名。

- [ ] **步骤 3：运行测试确认失败**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- \
src/views/orders/hooks/order-query.spec.ts \
src/views/orders/hooks/useOrderSupply.spec.ts \
src/views/orders/hooks/useOrderExport.spec.ts
```

Expected: FAIL，新模块不存在。

- [ ] **步骤 4：实现 feature API**

```ts
export const ordersApi = {
  list: (query: AdminOrderListQuery) =>
    apiClient.get<AdminOrderListResult>(withQuery('/admin/orders', query)),
  listSupply: (query: AdminOrderSupplyQuery) =>
    apiClient.get<AdminOrderSupplyResult>(
      withQuery('/admin/orders/supply', query),
    ),
  listSupplyItems: (query: AdminOrderSupplyDetailQuery) =>
    apiClient.get<AdminOrderSupplyDetailResult>(
      withQuery('/admin/orders/supply-items', query),
    ),
  export: (query: AdminOrderExportQuery) =>
    apiClient.getBlob(withQuery('/admin/orders/export', query)),
  getOne,
  updateStatus,
};
```

`withQuery` 对数组使用 `append`，其他值使用 `set`；不在 API 层映射 DTO。

- [ ] **步骤 5：拆分 hooks**

- `useOrderFilters`：唯一持有 `draft/applied`，不可变复制日期范围。
- `useOrderList`：订单 page/pageSize/total/items/detail/status；复用 request sequence。
- `useOrderSupply`：供货 page/pageSize/total/items、默认 statuses、`ReadonlyMap<groupKey, detail state>`；更新 map 时创建新 Map。
- `useOrderExport`：根据 view 生成无分页查询，调用 `saveBlob`。
- `useOrderWorkspace`：提供页面稳定形状：

```ts
return {
  mode,
  filters,
  orderList,
  supplyList,
  exportState,
  switchMode,
  search,
  reset,
};
```

不得在多个 hook 中各自复制筛选转换器。

- [ ] **步骤 6：清理旧订单 API 类型入口**

检查 `apps/admin-web/src/api/orders.ts` 与 `useOrderActions.ts`。将状态更新统一指向 `views/orders/api/index.ts` 或删除不再使用的错误 `OrderView[]` 列表类型；不得保留两套冲突客户端。

- [ ] **步骤 7：运行 hooks 测试与 typecheck**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- \
src/views/orders/hooks src/views/orders/api && \
pnpm --filter @bake-mall/admin-web typecheck
```

Expected: PASS。

---

### 任务 11：实现订单/SKU 供货双模式 UI

**Files:**

- Create: `apps/admin-web/src/views/orders/components/OrderModeSwitch.vue`
- Create: `apps/admin-web/src/views/orders/components/OrderModeSwitch.spec.ts`
- Create: `apps/admin-web/src/views/orders/components/OrderSupplyTable.vue`
- Create: `apps/admin-web/src/views/orders/components/OrderSupplyTable.spec.ts`
- Create: `apps/admin-web/src/views/orders/components/OrderSupplyDetail.vue`
- Create: `apps/admin-web/src/views/orders/config/supply-columns.ts`
- Modify: `apps/admin-web/src/views/orders/components/OrderFilters.vue`
- Modify: `apps/admin-web/src/views/orders/components/OrderTable.vue`
- Modify: `apps/admin-web/src/views/orders/config/columns.ts`
- Modify: `apps/admin-web/src/views/orders/OrdersView.vue`
- Modify: `apps/admin-web/src/views/orders/OrdersView.spec.ts`
- Modify: `apps/admin-web/src/constants/labels.ts`
- Modify: `apps/admin-web/src/views/orders/mock/list.mock.ts`
- Create: `apps/admin-web/src/views/orders/mock/supply.mock.ts`

- [ ] **步骤 1：写组件失败测试**

断言：

```ts
expect(modeSwitch.get('[aria-pressed="true"]').text()).toContain('订单模式');
await modeSwitch.get('[data-testid="supply-mode"]').trigger('click');
expect(modeSwitch.emitted('change')).toEqual([['SUPPLY']]);
```

供货表测试断言：

- “需供货数量”优先显示；
- `LEGACY_FALLBACK` 行有“历史匹配”文字，不只靠颜色；
- 剩余库存列名包含“参考”；
- 展开触发 `expand(groupKey)`；
- 详情错误只显示在对应行并有重试；
- 表格 `height="100%"`。

- [ ] **步骤 2：运行组件测试确认失败**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- \
src/views/orders/components/OrderModeSwitch.spec.ts \
src/views/orders/components/OrderSupplyTable.spec.ts \
src/views/orders/OrdersView.spec.ts
```

Expected: FAIL，新组件不存在。

- [ ] **步骤 3：实现模式切换与筛选差异**

`OrderModeSwitch` 使用 Element Plus segmented/radio button，右侧导出按钮：

```vue
<ElButton
  type="primary"
  :loading="exporting"
  :disabled="exporting"
  @click="$emit('export')"
>
  导出 Excel
</ElButton>
```

订单模式显示原单值 status；供货模式显示多选 `supplyStatuses`，选项仅待处理/处理中，且 UI 不允许清空最后一个状态。

- [ ] **步骤 4：扩展订单表列**

按规格加入商品种类/总件数、四类金额；表格保持固定操作列。金额全部通过 `formatPriceCents`，不允许 optional fallback。

- [ ] **步骤 5：实现供货汇总与展开明细**

主表列：商品/SKU、规格、需供货、订单数、待处理、处理中、剩余可售库存（参考）、最早下单、匹配状态、展开操作。

`OrderSupplyDetail` 展示订单号、状态、履约、联系人、履约快照、数量、备注、下单时间；明细分页通过“加载更多”或小型分页控件调用 hook，不一次性加载无限数据。

- [ ] **步骤 6：组装 OrdersView**

结构固定为：

```vue
<AdminPage workspace>
  <AdminPageHeader>
    <template #actions>
      <OrderModeSwitch ... />
    </template>
  </AdminPageHeader>
  <ElAlert v-if="activeError" ... />
  <AdminDataPanel fill>
    <template #toolbar><OrderFilters ... /></template>
    <OrderTable v-if="mode === 'ORDER'" ... />
    <OrderSupplyTable v-else ... />
    <template #footer><ElPagination ... /></template>
  </AdminDataPanel>
  <OrderDetailDrawer ... />
</AdminPage>
```

只读展示组件不得直接访问 API、router 或 Pinia。

- [ ] **步骤 7：运行订单页面测试与 typecheck**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- \
src/views/orders && \
pnpm --filter @bake-mall/admin-web typecheck
```

Expected: PASS。

---

### 任务 12：全链路验证与真实浏览器验收

**Files:**

- Modify only if verification exposes a confirmed defect.

- [ ] **步骤 1：运行格式与定向静态检查**

Run:

```bash
pnpm exec prettier --check \
packages/shared-contracts/src/admin-order.ts \
packages/shared-contracts/src/enums.ts \
apps/api/src/orders \
apps/api/src/database/migrations/0008-order-item-source-ids.ts \
apps/api/src/database/entities/order-item.entity.ts \
apps/admin-web/src/api/http.ts \
apps/admin-web/src/layouts/AdminLayout.vue \
apps/admin-web/src/components/layout \
apps/admin-web/src/views/orders \
docs/superpowers/specs/2026-07-28-admin-order-supply-workspace-design.md \
docs/superpowers/plans/2026-07-28-admin-order-supply-workspace.md
```

Expected: PASS。若失败，只格式化本任务文件，不运行全仓无关格式化。

- [ ] **步骤 2：运行三个受影响包的完整验证**

Run:

```bash
pnpm --filter @bake-mall/contracts test && \
pnpm --filter @bake-mall/contracts typecheck && \
pnpm --filter @bake-mall/contracts build && \
pnpm --filter @bake-mall/api test && \
pnpm --filter @bake-mall/api typecheck && \
pnpm --filter @bake-mall/api lint && \
pnpm --filter @bake-mall/api build && \
pnpm --filter @bake-mall/admin-web test && \
pnpm --filter @bake-mall/admin-web typecheck && \
pnpm --filter @bake-mall/admin-web lint && \
pnpm --filter @bake-mall/admin-web build
```

Expected: 全部 exit 0；任何失败都保留原始输出并先定位根因。

- [ ] **步骤 3：执行迁移并确认无待执行项**

Run:

```bash
pnpm --filter @bake-mall/api migration:run
pnpm --filter @bake-mall/api migration:run
```

Expected: 第一次应用 0008；第二次输出 `No migrations are pending`。

- [ ] **步骤 4：启动或复用当前项目**

Run:

```bash
pnpm dev
```

若 43173/43174 已由本仓库 Vite 占用，不终止未知进程；先确认命令行路径和 HTTP 200，再只补启动缺失的 API。确认：

```bash
curl -fsS http://127.0.0.1:43015/api/v1/health
curl -fsS -o /dev/null http://127.0.0.1:43174/
```

Expected: health `{"status":"ok"}`，Admin HTTP 200。

- [ ] **步骤 5：浏览器验证六个列表页滚动归属**

使用真实 Chrome，分别设置 1024×768、1440×900、1920×1080，登录：

```text
admin-local@example.com / admin-password
```

逐页验证 `/categories`、`/products`、`/banners`、`/orders`、`/membership-cards`、`/membership-purchases`：

```js
({
  bodyScrollHeight: document.body.scrollHeight,
  viewportHeight: window.innerHeight,
  bodyScrollable: document.body.scrollHeight > window.innerHeight,
  dataRegion: document
    .querySelector('[data-region="data"]')
    ?.getBoundingClientRect(),
});
```

Expected: workspace 页 `bodyScrollable === false`；表格有大量数据时 `.el-scrollbar__wrap` 或 `.el-table__body-wrapper` 可纵向滚动；分页始终在视口；横向滚动只有一层。展开更多筛选和显示错误 Alert 后仍满足。

- [ ] **步骤 6：浏览器验证非列表页不回归**

打开 `/products/new` 和 `/membership-cards/new`，确认长表单可自然滚动，Dialog/Drawer/Select 下拉层未被 canvas 裁切。

- [ ] **步骤 7：验证双模式与实际 Excel**

在 `/orders`：

1. 订单模式查询、分页、详情、状态操作。
2. 切换 SKU 供货模式，确认默认勾选待处理+处理中。
3. 核对汇总数量与展开订单项数量求和一致。
4. 输入商品关键词，确认同订单其他商品不混入。
5. 分别下载两类 Excel。
6. 用 ExcelJS 或本地 Excel 打开并核对：订单模式 1 Sheet，供货模式 2 Sheet；中文文件名、金额数值、手机号/ID 文本、历史匹配标记和公式注入样例正确。

- [ ] **步骤 8：最终差异和仓库状态检查**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: 无 whitespace error；只包含本功能文件和用户原有未跟踪归档文件。不得删除或提交 `bake-mall-minio.tar.gz`、`bake_mall.sql.gz`。

---

## 实施顺序与检查点

1. 任务 1–2 建立跨应用契约和不可变 SKU 来源快照。
2. 任务 3–6 完成 API 查询与 Excel，可独立通过 API/e2e 验证。
3. 任务 7–9 完成通用 Blob 下载和固定工作区，不依赖订单双模式 UI。
4. 任务 10–11 接入订单双模式。
5. 任务 12 执行完整包验证和真实浏览器验收。

任何阶段若测试失败，先使用 `superpowers:systematic-debugging` 定位根因；不得通过放宽断言、移除边界测试或把 Excel 截断到 50,000 行来规避失败。
