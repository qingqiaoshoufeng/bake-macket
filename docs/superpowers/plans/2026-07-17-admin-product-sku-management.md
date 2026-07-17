# Admin 商品与 SKU 管理实施计划

> **供智能代理执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐任务实施本计划。所有步骤使用复选框（`- [ ]`）跟踪；子代理不得创建顶层待办。

**目标：** 交付 Admin 商品列表、新建与编辑闭环，并以共享契约、事务归属校验、库存乐观锁、可配置媒体白名单和显式 Public DTO 保证 H5 可售结果正确。

**架构：** 共享契约先固定 Admin/Public 边界，再自底向上加入 `stockVersion` 数据库能力、订单扣库存版本递增、纯 DTO 映射和聚合保存事务。Admin 按 `api/`、`components/`、`hooks/`、`mock/`、`config/`、`type/` 六类职责拆分，页面只组合状态与呈现；H5 最后收敛到精确 Public DTO。每个实现任务都先增加一个能够证明缺口的失败测试，再写最小实现并执行聚焦 GREEN。

**技术栈：** pnpm 9.15.4、Node.js >= 22.13、TypeScript 5.8、NestJS 11、TypeORM 0.3、MySQL 8.4、Vitest 3.2、Vue 3.5、Vue Router 4.4、Element Plus 2.9、Vant 4、MinIO/COS/CDN。

## 全局约束

- 规格权威来源是 `docs/superpowers/specs/2026-07-16-admin-product-sku-management-design.md`；实现不得扩展 Banner、订单页面、小程序页面、SKU 人工排序或独立库存工作台。
- 所有需求、计划、任务简报、实施报告、审查报告、验收记录和用户沟通使用中文；代码、命令、路径、API、标识符和必要技术术语保留英文。
- 执行长任务时仅维护少量用户可见顶层待办，用户通过 `Ctrl+T` 显示或隐藏；子代理不得创建顶层待办；每完成一个顶层待办播报 `进度 N/M`、结果与下一步。
- 严格 TDD：先写 RED 测试并亲自看到指定失败，再写最小实现，最后运行 GREEN；不得先改生产代码。
- 任何跨 API 或应用边界的 DTO 只能从 `@bake-mall/contracts` 导入，不得在 API、Admin 或 H5 重复声明 wire type。
- 金额始终是整数分：使用 `priceCents`、`unitPriceCents`、`goodsTotalCents`；表单中的 `priceYuan` 仅是编辑字符串，提交前必须精确转换为非负整数分。
- 订单快照保持不可变；订单状态机和取消不回补库存规则不变；本切片只让下单扣库存同时递增 `stockVersion`。
- 新建下架商品允许零 SKU；上架商品至少一个启用 SKU；启用 SKU 可为零库存，但 Public `isAvailable=false`。
- 已存在 SKU 从编辑器移除时转为 `isActive=false` 并继续提交；新页面始终发送 `deletedSkuIds: []`，不得调用物理删除 SKU 接口。
- Admin 聚合保存只调用 `POST /admin/products` 与 `PUT /admin/products/:id`；旧 `PATCH` 与独立 SKU CRUD 保留兼容，但新页面不得调用。
- API 新增 Nest 源文件一律使用 `.js` 相对导入后缀；数据库继续使用 `utf8mb4` / `utf8mb4_unicode_ci`、`BIGINT UNSIGNED`、`INT UNSIGNED`、UTC `DATETIME`、`synchronize: false`。
- 对 `apps/admin-web/` 或 `apps/h5-store/` 的实现必须遵守 `frontend-page-generator` 与 `js-functional-style`：组件无请求、业务进入 hooks、配置为纯数据、mock 镜像契约、子组件 props 留在组件内、数组变换使用不可变 `map`/`filter`/`reduce`/`find`/`some`/`every`。
- 不引入第三方富文本编辑器；编辑器继续使用现有轻量实现，服务端清洗是持久化和预览的唯一可信边界。
- 不提交。每个任务只执行 diff check；除本计划外，规划阶段不得修改任何文件。实施时也不得覆盖当前 `.claude/CLAUDE.md` 未提交修改。

## 文件职责地图

### 共享契约

- `packages/shared-contracts/src/admin-catalog.ts`：Admin 商品/SKU 读取 DTO 与聚合保存可辨识联合。
- `packages/shared-contracts/src/catalog.ts`：Public 列表、详情、图片和 SKU DTO。
- `packages/shared-contracts/src/enums.ts`：新增稳定错误码。
- `packages/shared-contracts/src/admin-contracts.type-test.ts`：合法/非法 SKU 版本组合的编译期断言。

### API 与数据库

- `apps/api/src/database/migrations/0004-sku-stock-version.ts`：新增 `stock_version INT UNSIGNED NOT NULL DEFAULT 1`。
- `apps/api/src/database/entities/sku.entity.ts`：`@VersionColumn` 映射。
- `apps/api/src/catalog/product.mapper.ts`：五个无副作用 DTO 映射函数。
- `apps/api/src/catalog/media-asset-policy.service.ts`：`products/` object key 与配置 public URL 校验。
- `apps/api/src/catalog/catalog.service.ts`：显式列表/详情读取、聚合事务、归属校验与乐观锁。
- `apps/api/src/catalog/dto/save-product.dto.ts`：运行时校验 `id`/`stockVersion` 组合。
- `apps/api/src/content/html-sanitizer.service.ts`：按类型化配置清洗富文本图片。
- `apps/api/src/orders/orders.service.ts`：订单条件扣库存同步递增版本。

### Admin 商品域

- `apps/admin-web/src/views/products/api/index.ts`：只组合全局 `apiClient` 的 list/get/create/replace/remove。
- `apps/admin-web/src/views/products/type/form.ts`：页面内部表单、SKU 属性行和冲突状态，不重复 wire DTO。
- `apps/admin-web/src/views/products/hooks/useSkuEditor.ts`：不可变 SKU 草稿、价格/库存/属性校验和下架语义。
- `apps/admin-web/src/views/products/hooks/useProductsList.ts`：列表加载、错误、重试与删除刷新。
- `apps/admin-web/src/views/products/hooks/useProductEditor.ts`：DTO 映射、并行加载、校验、保存响应覆盖、409 草稿保留与重新加载。
- `apps/admin-web/src/views/products/config/columns.ts`、`defaults.ts`：表格列和新建默认值纯数据。
- `apps/admin-web/src/views/products/mock/list.mock.ts`、`detail.mock.ts`：共享 DTO 类型的稳定测试夹具。
- `apps/admin-web/src/views/products/components/*.vue`：纯展示/事件组件，不访问 API。
- `apps/admin-web/src/views/products/ProductsView.vue`、`ProductEditorView.vue`：页面组合、导航和中文消息边界。

### H5 商品消费

- `apps/h5-store/src/api/catalog.ts`：列表精确返回 `PublicProductSummaryView[]`，详情返回 `PublicProductDetailView`。
- `apps/h5-store/src/views/catalog/type/index.ts`：直接别名共享 DTO。
- `apps/h5-store/src/views/catalog/components/ProductCard.vue`：按可售 SKU 计算最低价格。
- `apps/h5-store/src/views/ProductDetailView.vue`：渲染服务端清洗 HTML并把 Public SKU 交给选择器。

---

### 任务 1：固定共享商品契约与错误码

**文件：**
- 修改：`packages/shared-contracts/src/admin-catalog.ts`
- 修改：`packages/shared-contracts/src/catalog.ts`
- 修改：`packages/shared-contracts/src/enums.ts`
- 修改：`packages/shared-contracts/src/admin-contracts.type-test.ts`

**接口：**
- 消费：既有 `MediaAsset`、`ProductImageView`、`SkuView`、`ApiErrorCode` 导出约定。
- 产出：`AdminSkuView.stockVersion: number`；`SaveProductSkuInput` 的新建/已有可辨识联合；`PublicProductSummaryView`、`PublicProductDetailView`；`ApiErrorCode.PRODUCT_STOCK_CONFLICT` 与 `ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID`。

- [ ] **步骤 1：先写会失败的类型断言**

在 `admin-contracts.type-test.ts` 增加以下完整断言，并从 `./index.js` 导入 `PublicProductDetailView`、`PublicProductSummaryView`、`SaveProductSkuInput`、`ApiErrorCode`：

```ts
const newSku: SaveProductSkuInput = {
  name: '6寸',
  attributes: { size: '6寸' },
  priceCents: 6800,
  stock: 0,
  isActive: true,
  image: null,
};

const existingSku: SaveProductSkuInput = {
  id: 'sku-1',
  stockVersion: 3,
  name: '8寸',
  attributes: { size: '8寸' },
  priceCents: 8800,
  stock: 2,
  isActive: true,
  image,
};

// @ts-expect-error 已有 SKU 必须携带 stockVersion。
const existingSkuWithoutVersion: SaveProductSkuInput = {
  id: 'sku-1',
  name: '8寸',
  attributes: {},
  priceCents: 8800,
  stock: 2,
  isActive: true,
  image: null,
};

// @ts-expect-error 新 SKU 不得单独携带 stockVersion。
const newSkuWithVersion: SaveProductSkuInput = {
  stockVersion: 1,
  name: '新规格',
  attributes: {},
  priceCents: 1000,
  stock: 0,
  isActive: false,
  image: null,
};

const publicSummary: PublicProductSummaryView = {
  id: 'product-1',
  categoryId: 'category-1',
  name: '草莓蛋糕',
  skus: [],
};
const publicDetail: PublicProductDetailView = {
  ...publicSummary,
  detailHtml: '<p>clean</p>',
  images: [],
};
const conflictCode: ApiErrorCode = ApiErrorCode.PRODUCT_STOCK_CONFLICT;
const ownershipCode: ApiErrorCode =
  ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID;

void [
  newSku,
  existingSku,
  existingSkuWithoutVersion,
  newSkuWithVersion,
  publicSummary,
  publicDetail,
  conflictCode,
  ownershipCode,
];
```

- [ ] **步骤 2：运行 RED 并确认失败原因**

运行：

```bash
pnpm --filter @bake-mall/contracts typecheck
```

预期：FAIL，至少报告 Public DTO 和两个错误码尚未导出；现有 `SaveProductSkuInput` 还允许非法组合，因此相应 `@ts-expect-error` 会报告未使用。

- [ ] **步骤 3：写最小共享类型实现**

在 `admin-catalog.ts` 中给 `AdminSkuView` 增加 `stockVersion`，并将保存 SKU 改成联合：

```ts
type SaveProductSkuFields = {
  name: string;
  attributes: Record<string, string>;
  priceCents: number;
  stock: number;
  isActive: boolean;
  image: MediaAsset | null;
};

export type SaveProductSkuInput = SaveProductSkuFields &
  (
    | { id?: never; stockVersion?: never }
    | { id: string; stockVersion: number }
  );
```

在 `catalog.ts` 中保留 `SkuView` 和 `ProductImageView`，新增：

```ts
export type PublicProductSummaryView = {
  id: string;
  categoryId: string;
  name: string;
  summary?: string;
  coverImageUrl?: string;
  skus: SkuView[];
};

export type PublicProductDetailView = PublicProductSummaryView & {
  detailHtml: string;
  images: ProductImageView[];
};

/** 兼容现有详情消费者；新边界应使用明确的 Summary/Detail 名称。 */
export type ProductView = PublicProductDetailView;
```

在 `ApiErrorCode` 末尾新增两个字符串值，禁止改动既有值：

```ts
PRODUCT_STOCK_CONFLICT = 'PRODUCT_STOCK_CONFLICT',
PRODUCT_ASSET_OWNERSHIP_INVALID = 'PRODUCT_ASSET_OWNERSHIP_INVALID',
```

- [ ] **步骤 4：运行 GREEN**

运行：

```bash
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts build
```

预期：三条命令退出码均为 0；类型断言证明只有 `id + stockVersion` 或两者都无效的两种合法形态。

- [ ] **步骤 5：检查任务 diff，不提交**

```bash
git diff --check -- packages/shared-contracts/src/admin-catalog.ts packages/shared-contracts/src/catalog.ts packages/shared-contracts/src/enums.ts packages/shared-contracts/src/admin-contracts.type-test.ts
git diff -- packages/shared-contracts/src/admin-catalog.ts packages/shared-contracts/src/catalog.ts packages/shared-contracts/src/enums.ts packages/shared-contracts/src/admin-contracts.type-test.ts
```

预期：第一条无输出；确认没有在应用内新增重复 wire DTO，也没有改变金额字段名称。

---

### 任务 2：增加 `stockVersion` 迁移与实体映射

**文件：**
- 新建：`apps/api/src/database/migrations/0004-sku-stock-version.ts`
- 新建：`apps/api/src/database/migrations/0004-sku-stock-version.spec.ts`
- 修改：`apps/api/src/database/entities/sku.entity.ts`
- 修改：`apps/api/src/database/data-source.ts`
- 修改：`apps/api/src/database/database.module.ts`

**接口：**
- 消费：前三个迁移的顺序、`Sku` 的 MySQL 命名约定。
- 产出：`Sku.stockVersion: number` 映射到 `stock_version INT UNSIGNED NOT NULL DEFAULT 1`；CLI 与 Nest runtime 使用相同迁移列表。

- [ ] **步骤 1：写迁移 RED 测试**

新建 `0004-sku-stock-version.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';

import { SkuStockVersion1718000000003 } from './0004-sku-stock-version.js';

describe('SkuStockVersion migration', () => {
  it('adds and removes the unsigned version column', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const runner = { query } as never;
    const migration = new SkuStockVersion1718000000003();

    await migration.up(runner);
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE `skus` ADD `stock_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `stock`',
    );

    query.mockClear();
    await migration.down(runner);
    expect(query).toHaveBeenCalledWith(
      'ALTER TABLE `skus` DROP COLUMN `stock_version`',
    );
  });
});
```

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/0004-sku-stock-version.spec.ts
```

预期：FAIL，提示无法解析 `./0004-sku-stock-version.js`。

- [ ] **步骤 3：实现迁移和实体列**

新迁移只执行以下 SQL：

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SkuStockVersion1718000000003 implements MigrationInterface {
  name = 'SkuStockVersion1718000000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `skus` ADD `stock_version` INT UNSIGNED NOT NULL DEFAULT 1 AFTER `stock`',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `skus` DROP COLUMN `stock_version`',
    );
  }
}
```

在 `sku.entity.ts` 导入 `VersionColumn`，紧接 `stock` 后添加：

```ts
@VersionColumn({
  name: 'stock_version',
  type: 'int',
  unsigned: true,
  default: 1,
})
stockVersion!: number;
```

在 `data-source.ts` 和 `database.module.ts` 导入 `SkuStockVersion1718000000003`，追加到既有迁移数组末尾；不得打开 `synchronize`。

- [ ] **步骤 4：运行 GREEN**

```bash
pnpm --filter @bake-mall/api test -- src/database/migrations/0004-sku-stock-version.spec.ts
pnpm --filter @bake-mall/api typecheck
```

预期：迁移测试 PASS，TypeScript 无装饰器或迁移导入错误。

- [ ] **步骤 5：检查任务 diff，不运行真实迁移、不提交**

```bash
git diff --check -- apps/api/src/database/migrations/0004-sku-stock-version.ts apps/api/src/database/migrations/0004-sku-stock-version.spec.ts apps/api/src/database/entities/sku.entity.ts apps/api/src/database/data-source.ts apps/api/src/database/database.module.ts
```

预期：无输出；确认 `up`/`down` 对称、列为 unsigned、默认版本为 `1`、两个迁移列表顺序相同。

---

### 任务 3：订单条件扣库存时递增版本

**文件：**
- 修改：`apps/api/src/orders/orders.service.spec.ts`
- 修改：`apps/api/src/orders/orders.service.ts`

**接口：**
- 消费：任务 2 的 `Sku.stockVersion`。
- 产出：下单成功的每个条件更新原子执行 `stock = stock - :quantity, stock_version = stock_version + 1`；库存不足与下架错误保持原样。

- [ ] **步骤 1：扩展内存 QueryBuilder 并写 RED 用例**

在测试 `buildService` 的两个 QueryBuilder stub 中记录 `.set(values)`，并在成功执行时仅当表达式存在才递增版本：

```ts
let setValues: Record<string, unknown> = {};
// builder 内：
set: (values: Record<string, unknown>) => {
  setValues = values;
  return builder;
},
// 成功扣减后：
sku.stock = (sku.stock as number) - quantity;
if (typeof setValues.stockVersion === 'function') {
  sku.stockVersion = Number(sku.stockVersion ?? 1) + 1;
}
```

增加用例：

```ts
it('increments stockVersion exactly once with a successful stock decrement', async () => {
  const records = buildService({
    users: [{ id: 'user-1', phone: '13800000000', phoneVerified: true }],
    products: [{ id: 'product-1', isActive: true }],
    skus: [{
      id: 'sku-1',
      productId: 'product-1',
      name: '6寸',
      priceCents: 6800,
      stock: 3,
      stockVersion: 7,
      isActive: true,
    }],
    cartItems: [
      { id: 'cart-1', userId: 'user-1', skuId: 'sku-1', quantity: 2 },
    ],
  });

  await records.service.create('user-1', 'version-key', {
    cartItemIds: ['cart-1'],
    fulfillmentType: FulfillmentType.PICKUP,
    contactName: '张三',
    contactPhone: '13800000000',
    pickupTimeText: '明天 10:00',
  });

  expect(records.skuRecords[0]).toMatchObject({ stock: 1, stockVersion: 8 });
});
```

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/api test -- src/orders/orders.service.spec.ts
```

预期：新增用例 FAIL，实际 `stockVersion` 仍为 `7`；既有库存不足、幂等和取消测试继续通过。

- [ ] **步骤 3：最小修改订单 SQL 表达式**

将订单服务 QueryBuilder 的 `.set` 改为：

```ts
.set({
  stock: () => 'stock - :quantity',
  stockVersion: () => 'stock_version + 1',
})
```

不得把更新拆成两个 SQL，不得改变 `WHERE id = :skuId AND stock >= :quantity AND is_active = true` 或 `affected !== 1` 回滚判断。

- [ ] **步骤 4：运行 GREEN**

```bash
pnpm --filter @bake-mall/api test -- src/orders/orders.service.spec.ts
pnpm --filter @bake-mall/api typecheck
```

预期：订单服务全部用例 PASS，版本只在成功扣减时加一，失败路径仍返回原错误码。

- [ ] **步骤 5：检查任务 diff，不提交**

```bash
git diff --check -- apps/api/src/orders/orders.service.ts apps/api/src/orders/orders.service.spec.ts
git diff -- apps/api/src/orders/orders.service.ts
```

预期：无空白错误；生产代码只有同一原子 `.set` 中增加版本表达式。

---

### 任务 4：建立 Admin/Public 显式 DTO 映射

**文件：**
- 新建：`apps/api/src/catalog/product.mapper.ts`
- 新建：`apps/api/src/catalog/product.mapper.spec.ts`
- 修改：`apps/api/src/catalog/catalog.service.ts`
- 修改：`apps/api/src/catalog/admin-products.controller.ts`
- 修改：`apps/api/src/catalog/public-catalog.controller.ts`

**接口：**
- 消费：任务 1 的共享 Admin/Public DTO，任务 2 的 `Sku.stockVersion`，既有 `Product`、`Category`、`ProductImage`、`Sku`。
- 产出：`toAdminProductSummaryView`、`toAdminProductDetailView`、`toPublicProductSummaryView`、`toPublicProductDetailView`、`toPublicSkuView`；响应不直接序列化 Entity。

- [ ] **步骤 1：写纯映射 RED 测试**

新建 `product.mapper.spec.ts`，构造包含内部 key、relations 与启停状态的实体，并锁定白名单：

```ts
import { describe, expect, it } from 'vitest';

import {
  toAdminProductDetailView,
  toAdminProductSummaryView,
  toPublicProductDetailView,
  toPublicProductSummaryView,
} from './product.mapper.js';

const category = { id: 'category-1', name: '蛋糕', isActive: true } as never;
const product = {
  id: 'product-1', categoryId: 'category-1', name: '草莓蛋糕',
  summary: '当日制作', coverImageUrl: 'https://cdn.example.com/products/a.webp',
  coverImageObjectKey: 'products/a.webp', detailHtml: '<p>clean</p>',
  sortOrder: 2, isActive: true,
  createdAt: new Date('2026-07-17T01:00:00.000Z'),
  updatedAt: new Date('2026-07-17T02:00:00.000Z'), category,
} as never;
const sku = {
  id: 'sku-1', productId: 'product-1', name: '6寸', attributes: { size: '6寸' },
  priceCents: 6800, stock: 2, stockVersion: 4, isActive: true,
  imageUrl: null, imageObjectKey: null,
} as never;
const image = {
  id: 'image-1', productId: 'product-1', url: 'https://cdn.example.com/products/b.webp',
  objectKey: 'products/b.webp', sortOrder: 0,
} as never;

describe('product mappers', () => {
  it('maps Admin summary/detail including MediaAsset and stockVersion', () => {
    expect(toAdminProductSummaryView(product, category, [sku])).toMatchObject({
      categoryName: '蛋糕', activeSkuCount: 1,
      coverImage: { objectKey: 'products/a.webp', publicUrl: 'https://cdn.example.com/products/a.webp' },
      createdAt: '2026-07-17T01:00:00.000Z',
    });
    expect(toAdminProductDetailView(product, category, [image], [sku]).skus[0])
      .toMatchObject({ id: 'sku-1', stockVersion: 4 });
  });

  it('returns only Public fields and computes availability from all three states', () => {
    const summary = toPublicProductSummaryView(product, category, [sku]);
    const detail = toPublicProductDetailView(product, category, [image], [sku]);
    expect(summary.skus[0].isAvailable).toBe(true);
    expect(detail.images).toEqual([{ id: 'image-1', url: image.url, sortOrder: 0 }]);
    expect(JSON.stringify(detail)).not.toMatch(
      /coverImageObjectKey|imageObjectKey|"isActive"|"category"/,
    );
    expect(toPublicProductSummaryView(product, { ...category, isActive: false }, [sku])
      .skus[0].isAvailable).toBe(false);
  });
});
```

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/api test -- src/catalog/product.mapper.spec.ts
```

预期：FAIL，提示 `product.mapper.js` 不存在。

- [ ] **步骤 3：实现五个纯函数**

`toPublicSkuView` 必须使用唯一公式：

```ts
export function toPublicSkuView(
  sku: Sku,
  productIsActive: boolean,
  categoryIsActive: boolean,
): SkuView {
  return {
    id: sku.id,
    name: sku.name,
    attributes: { ...sku.attributes },
    priceCents: sku.priceCents,
    stock: sku.stock,
    ...(sku.imageUrl ? { imageUrl: sku.imageUrl } : {}),
    isAvailable:
      productIsActive && categoryIsActive && sku.isActive && sku.stock > 0,
  };
}
```

其余函数只组装共享类型；Admin summary 用 `skus.filter(({ isActive }) => isActive).length`，Admin detail 复用 summary 后移除 `activeSkuCount`，Public summary 不含 `detailHtml/images`，Public detail 在 summary 上增加清洗后的 `detailHtml` 和有序图片。所有时间调用 `.toISOString()`，所有数组/对象返回新引用。

- [ ] **步骤 4：让服务和控制器只返回共享 DTO**

将 `listProducts()` 改为并行读取每个商品 SKU 并调用 `toAdminProductSummaryView`；`getAdminProduct()` 和聚合保存返回调用 `toAdminProductDetailView`。将 Public 方法签名改为：

```ts
async listPublicProducts(
  query: PublicProductsQueryDto,
): Promise<PublicProductSummaryView[]>;

async getPublicProduct(id: string): Promise<PublicProductDetailView>;
```

Public 查询完成过滤后加载 SKU，再调用 mapper；不得 `Object.assign(product, { skus, images })`。控制器方法添加对应显式 Promise 返回类型，删除 `catalog.service.ts` 尾部旧 `toAdminProductDetail`。

- [ ] **步骤 5：运行 GREEN**

```bash
pnpm --filter @bake-mall/api test -- src/catalog/product.mapper.spec.ts src/catalog/catalog.service.spec.ts
pnpm --filter @bake-mall/api typecheck
```

预期：映射测试与既有 catalog 测试 PASS；类型检查证明 controller/service 边界是共享 DTO。

- [ ] **步骤 6：检查任务 diff，不提交**

```bash
git diff --check -- apps/api/src/catalog/product.mapper.ts apps/api/src/catalog/product.mapper.spec.ts apps/api/src/catalog/catalog.service.ts apps/api/src/catalog/admin-products.controller.ts apps/api/src/catalog/public-catalog.controller.ts
rg -n 'Object\.assign\(product|Promise<Product\[\]>|Promise<Product>' apps/api/src/catalog
```

预期：`git diff --check` 无输出；第二条不在 Admin/Public 商品读取路径命中直接 Entity 返回。

---

### 任务 5：为聚合保存加入归属校验与 `409` 乐观锁

**文件：**
- 修改：`apps/api/src/catalog/dto/save-product.dto.ts`
- 修改：`apps/api/src/catalog/catalog.service.ts`
- 修改：`apps/api/src/catalog/catalog.service.spec.ts`
- 修改：`apps/api/test/catalog.e2e-spec.ts`

**接口：**
- 消费：`SaveProductSkuInput` 联合、`Sku.stockVersion`、任务 4 mapper、`ApiErrorCode`。
- 产出：运行时 `id`/`stockVersion` 组合校验；跨商品 SKU/图片返回 `422 PRODUCT_ASSET_OWNERSHIP_INVALID`；版本未命中返回 `409 PRODUCT_STOCK_CONFLICT`；任何失败回滚整笔事务。

- [ ] **步骤 1：写归属和冲突 RED 单元测试**

在 `catalog.service.spec.ts` 增加两个测试。测试 manager 的 repository 必须分别返回当前商品资产与其他商品资产，并让 QueryBuilder 的 `execute()` 可返回 `{ affected: 0 }`：

```ts
it('rejects a SKU or image id owned by another product with 422', async () => {
  const service = buildAggregateService({
    product: { id: 'product-1' },
    skus: [{ id: 'sku-own', productId: 'product-1', stockVersion: 1 }],
    images: [{ id: 'image-other', productId: 'product-2' }],
  });
  const request = aggregateRequest({
    images: [{
      id: 'image-other', objectKey: 'products/x.webp',
      publicUrl: 'https://cdn.example.com/products/x.webp', sortOrder: 0,
    }],
  });

  await expect(
    service.saveProductAggregate('product-1', request, 'admin-1'),
  ).rejects.toMatchObject({ status: 422 });
});

it('rolls back with PRODUCT_STOCK_CONFLICT when stockVersion is stale', async () => {
  const { service, transaction } = buildAggregateService({
    product: { id: 'product-1' },
    skus: [{ id: 'sku-1', productId: 'product-1', stockVersion: 5 }],
    conditionalAffected: 0,
  });
  const request = aggregateRequest({
    skus: [{
      id: 'sku-1', stockVersion: 4, name: '6寸', attributes: {},
      priceCents: 6800, stock: 3, isActive: true, image: null,
    }],
  });

  await expect(
    service.saveProductAggregate('product-1', request, 'admin-1'),
  ).rejects.toSatisfy((error: ConflictException) =>
    (error.getResponse() as { code: ApiErrorCode }).code ===
      ApiErrorCode.PRODUCT_STOCK_CONFLICT,
  );
  expect(transaction).toHaveBeenCalledTimes(1);
});
```

测试文件内实现 `aggregateRequest(overrides)` 返回完整 `SaveProductRequest`，默认 `isActive=false`、`deletedSkuIds=[]`，不得使用不完整 cast 掩盖契约。

- [ ] **步骤 2：写 DTO 组合 RED e2e 断言并运行**

在 `catalog.e2e-spec.ts` 增加两次无效请求：已有 `id` 无版本、新 SKU 只有版本，均期望 `400`。运行：

```bash
pnpm --filter @bake-mall/api test -- src/catalog/catalog.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- catalog.e2e-spec.ts
```

预期：FAIL；当前服务会重新绑定/覆盖资产，条件更新不存在，DTO 也接受非法组合。

- [ ] **步骤 3：实现 DTO 交叉字段校验**

在 `save-product.dto.ts` 为 `stockVersion` 增加 `@IsOptional() @Type(() => Number) @IsInt() @Min(1)`，并增加类级自定义 validator `HasMatchingSkuIdentityConstraint`，其校验逻辑必须是：

```ts
const hasId = typeof value.id === 'string' && value.id.length > 0;
const hasVersion = Number.isInteger(value.stockVersion);
return hasId === hasVersion;
```

把该约束通过一个只用于类级校验的属性应用到 `SaveProductSkuDto`；错误文本固定为 `id 与 stockVersion 必须同时提供或同时省略`。

- [ ] **步骤 4：在事务开头校验归属**

PUT 找到商品后并行读取：

```ts
const [existingSkus, existingImages] = await Promise.all([
  skuRepository.find({ where: { productId: id } }),
  imageRepository.find({ where: { productId: id } }),
]);
```

建立当前商品 ID set；请求中任何 `sku.id`、`image.id` 或 `deletedSkuIds` 不在 set 时抛：

```ts
throw new UnprocessableEntityException({
  code: ApiErrorCode.PRODUCT_ASSET_OWNERSHIP_INVALID,
  message: 'SKU 或商品图片不属于当前商品',
});
```

新建商品请求带任意资产 ID 同样拒绝。所有校验必须发生在保存商品、删除图片、更新 SKU 和写审计之前。

- [ ] **步骤 5：实现逐 SKU 条件更新**

新 SKU 用 `insert/save`，初始版本依赖数据库/实体默认 `1`。已有 SKU 每行执行：

```ts
const result = await skuRepository
  .createQueryBuilder()
  .update(Sku)
  .set({
    name: sku.name,
    attributes: { ...sku.attributes },
    priceCents: sku.priceCents,
    stock: sku.stock,
    imageUrl: sku.image?.publicUrl ?? null,
    imageObjectKey: sku.image?.objectKey ?? null,
    isActive: sku.isActive,
    stockVersion: () => 'stock_version + 1',
  })
  .where(
    'id = :id AND product_id = :productId AND stock_version = :stockVersion',
    { id: sku.id, productId: savedProduct.id, stockVersion: sku.stockVersion },
  )
  .execute();
```

若 `affected !== 1`，立即抛 `ConflictException`，body 为：

```ts
{
  code: ApiErrorCode.PRODUCT_STOCK_CONFLICT,
  message: '库存已发生变化，请重新加载后再保存',
  details: { skuId: sku.id },
}
```

保留 `deletedSkuIds` 兼容物理删除分支，但新页面不使用。图片先按归属校验，再保存请求中的完整集合并删除当前商品中未提交的图片。事务尾部重新读取最新 SKU/图片或以更新后的版本构造结果，保证响应包含真实最新 `stockVersion`。

- [ ] **步骤 6：运行 GREEN**

```bash
pnpm --filter @bake-mall/api test -- src/catalog/catalog.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- catalog.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
```

预期：归属错误为 422、旧版本为 409、非法 DTO 为 400；下架零 SKU仍可保存，上架无启用 SKU仍被拒绝；成功聚合保存返回递增后的版本。

- [ ] **步骤 7：检查任务 diff，不提交**

```bash
git diff --check -- apps/api/src/catalog/dto/save-product.dto.ts apps/api/src/catalog/catalog.service.ts apps/api/src/catalog/catalog.service.spec.ts apps/api/test/catalog.e2e-spec.ts
rg -n 'PRODUCT_STOCK_CONFLICT|PRODUCT_ASSET_OWNERSHIP_INVALID|stock_version = stock_version \+ 1' apps/api/src/catalog apps/api/test/catalog.e2e-spec.ts
```

预期：无格式错误，三类关键保护均有生产代码与测试命中；事务外没有资产写入。

---

### 任务 6：配置媒体资产与富文本图片白名单

**文件：**
- 新建：`apps/api/src/catalog/media-asset-policy.service.ts`
- 新建：`apps/api/src/catalog/media-asset-policy.service.spec.ts`
- 新建：`apps/api/src/content/html-sanitizer.service.spec.ts`
- 修改：`apps/api/src/config/env.schema.ts`
- 修改：`apps/api/src/content/html-sanitizer.service.ts`
- 修改：`apps/api/src/catalog/catalog.module.ts`
- 修改：`apps/api/src/catalog/catalog.service.ts`
- 修改：`apps/api/src/catalog/catalog.service.spec.ts`

**接口：**
- 消费：`AppConfig.appEnv.OBJECT_STORAGE_PUBLIC_BASE_URL` 与聚合 `MediaAsset`。
- 产出：`PRODUCT_MEDIA_ALLOWED_ORIGINS: string[]` 类型化配置；`MediaAssetPolicyService.assertProductAsset(asset)`；开发允许配置的 `http://127.0.0.1:*`，生产只接受配置的 HTTPS COS/CDN。

- [ ] **步骤 1：写媒体与 sanitizer RED 测试**

`media-asset-policy.service.spec.ts` 覆盖：`products/cover.webp` + 配置 CDN 成功；`banners/x.webp` 失败；恶意主机失败。`html-sanitizer.service.spec.ts` 使用以下核心断言：

```ts
const service = buildSanitizer({
  NODE_ENV: 'development',
  OBJECT_STORAGE_PUBLIC_BASE_URL: 'http://127.0.0.1:9000/bake-mall',
  PRODUCT_MEDIA_ALLOWED_ORIGINS: [
    'http://127.0.0.1:9000',
    'https://cdn.example.com',
  ],
});

expect(service.sanitize(
  '<img src="http://127.0.0.1:9000/bake-mall/products/a.webp">' +
  '<img src="https://cdn.example.com/products/b.webp">' +
  '<img src="https://evil.example/products/c.webp">',
)).toBe(
  '<img src="http://127.0.0.1:9000/bake-mall/products/a.webp" />' +
  '<img src="https://cdn.example.com/products/b.webp" />',
);
```

再增加 production 测试，确认即使配置 `http://127.0.0.1:9000` 也移除 HTTP 图片。

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/api test -- src/catalog/media-asset-policy.service.spec.ts src/content/html-sanitizer.service.spec.ts
```

预期：FAIL，媒体策略文件不存在；现 sanitizer 硬编码 COS 正则并拒绝开发 MinIO/配置 CDN。

- [ ] **步骤 3：增加类型化配置**

在 `AppEnv` 添加：

```ts
PRODUCT_MEDIA_ALLOWED_ORIGINS: string[];
```

Joi 字段把逗号分隔环境值正规化为去空白数组；缺省值为 `['http://127.0.0.1:9000']`。生产校验不强制默认通过，实际 sanitizer/媒体策略还必须检查协议。`.env` 凭据文件不进入版本控制，本任务不创建环境文件。

- [ ] **步骤 4：实现共享 URL 判定与两个服务**

`media-asset-policy.service.ts` 导出纯函数：

```ts
export function isAllowedProductPublicUrl(
  rawUrl: string,
  env: Pick<AppEnv, 'NODE_ENV' | 'OBJECT_STORAGE_PUBLIC_BASE_URL' |
    'PRODUCT_MEDIA_ALLOWED_ORIGINS'>,
): boolean;
```

判定规则：URL 必须可解析；production 只允许 `https:`；development/test 可允许明确配置的 `http://127.0.0.1:*`；URL `origin` 必须在允许 origin set；对象存储 base URL 自身的 origin 自动并入 set。`assertProductAsset` 同时要求 `objectKey.startsWith('products/')`，否则抛 `UnprocessableEntityException` 和 `PRODUCT_ASSET_OWNERSHIP_INVALID`。

`HtmlSanitizerService` 注入 `ConfigService<AppConfig, true>`，`sanitizeProductHtml(input, env)` 继续保留既有标签/属性限制，并在 `exclusiveFilter` 对 img 调用同一个 URL 纯函数。链接仍仅允许 HTTPS；开发 HTTP 例外只适用于命中配置的 img URL。

- [ ] **步骤 5：接入聚合保存**

在 `CatalogModule` 注册 `MediaAssetPolicyService`。在 `saveProductAggregate` 开事务前或事务首个写操作前，对 `coverImage`、`images` 和每个非空 SKU image 执行 `assertProductAsset`；使用 `filter`/`map`，不写可变收集循环。更新现有单测构造器，为新增依赖传可控 stub。

- [ ] **步骤 6：运行 GREEN**

```bash
pnpm --filter @bake-mall/api test -- src/catalog/media-asset-policy.service.spec.ts src/content/html-sanitizer.service.spec.ts src/catalog/catalog.service.spec.ts
pnpm --filter @bake-mall/api typecheck
```

预期：MinIO、配置 CDN/COS 被保留，未配置主机被移除；错误 objectKey/publicUrl 在聚合写入前以 422 拒绝。

- [ ] **步骤 7：检查任务 diff，不提交**

```bash
git diff --check -- apps/api/src/config/env.schema.ts apps/api/src/catalog/media-asset-policy.service.ts apps/api/src/catalog/media-asset-policy.service.spec.ts apps/api/src/content/html-sanitizer.service.ts apps/api/src/content/html-sanitizer.service.spec.ts apps/api/src/catalog/catalog.module.ts apps/api/src/catalog/catalog.service.ts apps/api/src/catalog/catalog.service.spec.ts
rg -n 'COS_HOSTNAME|myqcloud\.com' apps/api/src/content apps/api/src/catalog
```

预期：diff check 无输出；硬编码 COS hostname 正则无命中，允许来源完全来自类型化配置。

---

### 任务 7：补齐 Admin `put` 与商品域 API

**文件：**
- 新建：`apps/admin-web/src/api/http.spec.ts`
- 修改：`apps/admin-web/src/api/http.ts`
- 新建：`apps/admin-web/src/views/products/api/index.ts`
- 新建：`apps/admin-web/src/views/products/api/index.spec.ts`
- 修改：`apps/admin-web/src/api/catalog.ts`

**接口：**
- 消费：共享 `AdminProductSummaryView`、`AdminProductDetailView`、`SaveProductRequest`，全局 `apiClient`。
- 产出：`ApiClient.put<T>(path, body?, init?)`；`productsApi.list/getOne/create/replace/remove` 精确签名；新商品页面不依赖旧 product/SKU wire types。

- [ ] **步骤 1：写 `put` 与路径 RED 测试**

`http.spec.ts` mock `fetch`，调用 `new ApiClient('/api/v1').put('/admin/products/1', { name: '蛋糕' })`，断言 URL、`method: 'PUT'`、JSON body。`views/products/api/index.spec.ts` mock `apiClient` 并断言：

```ts
await productsApi.list();
await productsApi.getOne('product-1');
await productsApi.create(body);
await productsApi.replace('product-1', body);
await productsApi.remove('product-1');

expect(apiClient.get).toHaveBeenNthCalledWith(1, '/admin/products');
expect(apiClient.get).toHaveBeenNthCalledWith(2, '/admin/products/product-1');
expect(apiClient.post).toHaveBeenCalledWith('/admin/products', body);
expect(apiClient.put).toHaveBeenCalledWith('/admin/products/product-1', body);
expect(apiClient.delete).toHaveBeenCalledWith('/admin/products/product-1');
```

测试 `body` 是完整 `SaveProductRequest`，含 `deletedSkuIds: []`。

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/api/http.spec.ts src/views/products/api/index.spec.ts
```

预期：FAIL，`ApiClient.put` 与商品域 API 文件不存在。

- [ ] **步骤 3：实现最小 API 组合**

在 `ApiClient` 的 `patch` 前增加：

```ts
put<T>(path: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
  return this.request<T>(path, { ...init, method: 'PUT', body });
}
```

`views/products/api/index.ts` 只允许以下实现，不做映射和错误分支：

```ts
import type {
  AdminProductDetailView,
  AdminProductSummaryView,
  SaveProductRequest,
} from '@bake-mall/contracts';

import { apiClient } from '../../../api/http.js';

export const productsApi = {
  list: (): Promise<AdminProductSummaryView[]> =>
    apiClient.get('/admin/products'),
  getOne: (id: string): Promise<AdminProductDetailView> =>
    apiClient.get(`/admin/products/${id}`),
  create: (body: SaveProductRequest): Promise<AdminProductDetailView> =>
    apiClient.post('/admin/products', body),
  replace: (
    id: string,
    body: SaveProductRequest,
  ): Promise<AdminProductDetailView> =>
    apiClient.put(`/admin/products/${id}`, body),
  remove: (id: string): Promise<void> =>
    apiClient.delete(`/admin/products/${id}`),
};
```

从 `apps/admin-web/src/api/catalog.ts` 删除重复 `AdminProductView`、`AdminSkuView` 和 product/SKU request wire 类型；旧兼容方法若其他代码仍引用，改为直接使用共享 DTO 或暂时保留方法但不得由 `productsApi` 调用。分类类型改为导入共享 `AdminCategoryView`，不得重复声明。

- [ ] **步骤 4：运行 GREEN**

```bash
pnpm --filter @bake-mall/admin-web test -- src/api/http.spec.ts src/views/products/api/index.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
```

预期：两个测试文件 PASS；全局客户端正确序列化 PUT；商品域 API 只暴露五个聚合操作。

- [ ] **步骤 5：检查任务 diff，不提交**

```bash
git diff --check -- apps/admin-web/src/api/http.ts apps/admin-web/src/api/http.spec.ts apps/admin-web/src/api/catalog.ts apps/admin-web/src/views/products/api/index.ts apps/admin-web/src/views/products/api/index.spec.ts
rg -n 'type AdminProductView|type AdminSkuView|CreateProductRequest|CreateSkuRequest' apps/admin-web/src
```

预期：diff check 无输出；第二条不命中新商品页面的重复 wire type。

---

### 任务 8：重构上传、富文本、轮播图与 SKU 编辑组件

**文件：**
- 修改：`apps/admin-web/src/components/CosImageUploader.vue`
- 新建：`apps/admin-web/src/components/CosImageUploader.spec.ts`
- 修改：`apps/admin-web/src/components/RichTextEditor.vue`
- 新建：`apps/admin-web/src/components/RichTextEditor.spec.ts`
- 新建：`apps/admin-web/src/views/products/type/form.ts`
- 修改：`apps/admin-web/src/views/products/hooks/useSkuEditor.ts`
- 新建：`apps/admin-web/src/views/products/hooks/useSkuEditor.spec.ts`
- 修改：`apps/admin-web/src/views/products/components/SkuTableEditor.vue`
- 修改：`apps/admin-web/src/views/products/components/SkuTableEditor.spec.ts`
- 新建：`apps/admin-web/src/views/products/components/ProductImagesEditor.vue`
- 新建：`apps/admin-web/src/views/products/components/ProductImagesEditor.spec.ts`

**接口：**
- 消费：`MediaAsset`、`AdminProductImageView`、`SaveProductSkuInput`、`performUpload`、整数分 money helper。
- 产出：上传器 `modelValue: MediaAsset | null`；富文本正确初始化 HTML；`ProductImageFormRow`；完整 `SkuFormRow`；已有 SKU 删除转下架；上传状态向父级汇总。

- [ ] **步骤 1：写三个组件与 hook 的 RED 测试**

测试必须覆盖以下具体断言：

```ts
// CosImageUploader：上传成功与清空都发送完整值。
expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({
  objectKey: 'products/a.webp',
  publicUrl: 'http://127.0.0.1:9000/bake-mall/products/a.webp',
});
await wrapper.get('[data-testid="clear-image"]').trigger('click');
expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBeNull();

// RichTextEditor：不能把标签显示成文本节点。
expect(wrapper.get('[data-testid="rich-editor-surface"]').element.innerHTML)
  .toBe('<p><strong>已清洗内容</strong></p>');
expect(wrapper.text()).toContain('已清洗内容');
expect(wrapper.text()).not.toContain('<strong>');

// useSkuEditor：零库存合法、三位小数非法、重复属性非法、已有删除下架。
expect(editor.toInput()).toEqual([
  {
    id: 'sku-1',
    stockVersion: 3,
    name: '6寸',
    attributes: { size: '6寸' },
    priceCents: 6850,
    stock: 0,
    isActive: true,
    image: null,
  },
]);
expect(() => editor.setPriceYuan(rowId, '68.501')).toThrow('价格最多保留两位小数');
expect(() => editor.setAttributes(rowId, [
  { key: '口味', value: '草莓' }, { key: '口味', value: '巧克力' },
])).toThrow('SKU 属性键不能重复');
editor.removeRow(existingRowId);
expect(editor.toInput()?.[0]).toMatchObject({
  id: 'sku-1', stockVersion: 3, isActive: false,
});
```

`ProductImagesEditor.spec.ts` 断言添加 `MediaAsset` 后生成递增 `sortOrder`，移除后重新连续排序，已有图片的 `id` 保留，所有数组输入保持不变。

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/components/CosImageUploader.spec.ts src/components/RichTextEditor.spec.ts src/views/products/hooks/useSkuEditor.spec.ts src/views/products/components/SkuTableEditor.spec.ts src/views/products/components/ProductImagesEditor.spec.ts
```

预期：FAIL；上传器仍以 string 为持久化接口，富文本把 HTML 作为标签源码文本，SKU 不含属性/版本/MediaAsset且拒绝零库存，轮播图组件不存在。

- [ ] **步骤 3：定义页面内部表单类型**

`type/form.ts` 只定义 UI 状态，不复制 wire DTO：

```ts
import type { AdminProductImageView, MediaAsset } from '@bake-mall/contracts';

export type SkuAttributeRow = { readonly key: string; readonly value: string };
export type SkuFormRow = {
  readonly rowId: string;
  readonly id?: string;
  readonly stockVersion?: number;
  readonly name: string;
  readonly attributes: readonly SkuAttributeRow[];
  readonly priceYuan: string;
  readonly stock: number;
  readonly isActive: boolean;
  readonly image: MediaAsset | null;
};
export type ProductImageFormRow = Omit<AdminProductImageView, 'id'> & {
  readonly localId: string;
  readonly id?: string;
};
```

任务 10 将在同一文件追加 `ProductFormShape`，不得新建平行 form type 文件。

- [ ] **步骤 4：统一上传器契约与富文本初始化**

`CosImageUploader` props 改为 `modelValue: MediaAsset | null`，emit 改为：

```ts
const emit = defineEmits<{
  'update:modelValue': [value: MediaAsset | null];
  'uploading-change': [value: boolean];
}>();
```

上传开始/结束发送 `uploading-change`，成功只发送完整 `MediaAsset`，失败保留原 `modelValue`，清空按钮发送 `null`；删除手工 URL 输入。预览由 `props.modelValue?.publicUrl` 派生。

`RichTextEditor` 删除模板中的 `{{ modelValue }}`，给 surface 加 `data-testid`，在 `onMounted` 与 prop watcher 中通过 `editorRef.value.innerHTML = next` 同步。输入事件仍发 innerHTML，父值相同不重复 emit。

- [ ] **步骤 5：不可变重写 SKU hook 与组件**

`useSkuEditor` 接收 `readonly SkuFormRow[]`，每次更新用 `map/filter/spread` 返回新数组。价格只接受 `/^(0|[1-9]\d*)(\.\d{1,2})?$/`，用字符串拆分为整数分，禁止浮点乘法；库存要求 `Number.isInteger(stock) && stock >= 0`。属性 trim 后键非空且唯一，再转为 `Object.fromEntries`。`toInput(): SaveProductSkuInput[] | null` 保留 `id + stockVersion`，新 SKU 两者都省略。

`removeRow` 对无 `id` 行 `filter` 掉；对有 `id` 行改为 `{ ...row, isActive: false }`。组件展示属性编辑、`CosImageUploader` 和“下架”文案；不得直接请求 API。

- [ ] **步骤 6：实现轮播图编辑器**

`ProductImagesEditor` props 为 `modelValue: readonly ProductImageFormRow[]`，emit `update:modelValue` 与 `uploading-change`。添加图片时生成本地 stable id；删除后用 `filter(...).map((image, sortOrder) => ({ ...image, sortOrder }))`；已有 `id` 原样保留。每个位置复用 `CosImageUploader scope="products"`。

- [ ] **步骤 7：运行 GREEN**

```bash
pnpm --filter @bake-mall/admin-web test -- src/components/CosImageUploader.spec.ts src/components/RichTextEditor.spec.ts src/views/products/hooks/useSkuEditor.spec.ts src/views/products/components/SkuTableEditor.spec.ts src/views/products/components/ProductImagesEditor.spec.ts
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/admin-web typecheck
```

预期：所有组件/hook 测试 PASS；零库存可提交，价格和属性非法值被阻止，已有 SKU 只下架不消失，上传中状态可由父级禁止保存。

- [ ] **步骤 8：检查任务 diff，不提交**

```bash
git diff --check -- apps/admin-web/src/components/CosImageUploader.vue apps/admin-web/src/components/CosImageUploader.spec.ts apps/admin-web/src/components/RichTextEditor.vue apps/admin-web/src/components/RichTextEditor.spec.ts apps/admin-web/src/views/products/type/form.ts apps/admin-web/src/views/products/hooks/useSkuEditor.ts apps/admin-web/src/views/products/hooks/useSkuEditor.spec.ts apps/admin-web/src/views/products/components/SkuTableEditor.vue apps/admin-web/src/views/products/components/SkuTableEditor.spec.ts apps/admin-web/src/views/products/components/ProductImagesEditor.vue apps/admin-web/src/views/products/components/ProductImagesEditor.spec.ts
rg -n 'update:modelValue.*string|initialUrl|Math\.round\(Number\(.*\) \* 100\)|deletedSkuIds' apps/admin-web/src/components apps/admin-web/src/views/products
```

预期：diff check 无输出；不再有 string 媒体持久化接口、浮点元转分或新页面物理删除列表。

---

### 任务 9：实现 Admin 商品列表

**文件：**
- 新建：`apps/admin-web/src/views/products/config/columns.ts`
- 新建：`apps/admin-web/src/views/products/mock/list.mock.ts`
- 新建：`apps/admin-web/src/views/products/hooks/useProductsList.ts`
- 新建：`apps/admin-web/src/views/products/hooks/useProductsList.spec.ts`
- 新建：`apps/admin-web/src/views/products/components/ProductTable.vue`
- 新建：`apps/admin-web/src/views/products/components/ProductTable.spec.ts`
- 新建：`apps/admin-web/src/views/products/ProductsView.vue`
- 新建：`apps/admin-web/src/views/products/ProductsView.spec.ts`
- 新建：`apps/admin-web/src/views/products/index.ts`

**接口：**
- 消费：任务 7 `productsApi`、共享 `AdminProductSummaryView`、Element Plus。
- 产出：真实列表、页面错误重试、删除确认与刷新、`create`/`edit` 导航事件；组件无 API。

- [ ] **步骤 1：写 hook、表格和页面 RED 测试**

`useProductsList.spec.ts` mock `productsApi`，断言首次加载、错误保留、重试清错、删除成功刷新、删除失败不移除本地项。`ProductTable.spec.ts` 使用 `list.mock.ts`，断言列名严格为 `名称/分类/主图/启用 SKU 数/排序/上架状态/操作`，并断言 edit/remove 事件携带 id。`ProductsView.spec.ts` 断言：

```ts
expect(wrapper.get('[data-testid="create-product"]').text()).toContain('新增商品');
await wrapper.get('[data-testid="retry-products"]').trigger('click');
expect(api.list).toHaveBeenCalledTimes(2);
await wrapper.get('[data-testid="edit-product-1"]').trigger('click');
expect(router.push).toHaveBeenCalledWith('/products/product-1/edit');
```

删除测试 mock `ElMessageBox.confirm`，确认取消不调用 API，确认后调用 remove；失败显示中文错误且行仍在。

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/products/hooks/useProductsList.spec.ts src/views/products/components/ProductTable.spec.ts src/views/products/ProductsView.spec.ts
```

预期：FAIL，三个实现文件和配置/mock 尚不存在。

- [ ] **步骤 3：实现纯配置与共享 DTO mock**

`columns.ts` 导出 readonly `PRODUCT_COLUMNS`，每项含稳定 `key/label/width|minWidth`。`list.mock.ts` 声明 `readonly AdminProductSummaryView[]`，主图必须是完整 `MediaAsset`，时间为 ISO 字符串，至少包含一个上架和一个下架商品。

- [ ] **步骤 4：实现列表 hook**

返回稳定 shape：

```ts
{
  products, loading, deletingId, lastError,
  refresh, remove,
}
```

`refresh` 用 try/catch/finally；成功赋新数组；失败设置中文消息但不破坏已有列表。`remove(id)` 只在 API 成功后 `await refresh()`；失败重新抛出供页面显示，且不做乐观删除。

- [ ] **步骤 5：实现纯表格与页面组合**

`ProductTable` 只接 props 并 emit `edit/remove`，主图读取 `coverImage?.publicUrl`，状态使用 `ElTag`。`ProductsView` 在 `onMounted` 调用 refresh；新增导航 `/products/new`，编辑导航 `/products/${id}/edit`；列表错误显示页面级 alert 与重试按钮；删除走确认框和 hook。`index.ts` 导出两个页面供路由 lazy import 使用。

- [ ] **步骤 6：运行 GREEN**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/products/hooks/useProductsList.spec.ts src/views/products/components/ProductTable.spec.ts src/views/products/ProductsView.spec.ts
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/admin-web typecheck
```

预期：列表、删除、错误重试和导航测试全部 PASS；表格组件中没有 `productsApi`/`fetch`。

- [ ] **步骤 7：检查任务 diff，不提交**

```bash
git diff --check -- apps/admin-web/src/views/products/config/columns.ts apps/admin-web/src/views/products/mock/list.mock.ts apps/admin-web/src/views/products/hooks/useProductsList.ts apps/admin-web/src/views/products/hooks/useProductsList.spec.ts apps/admin-web/src/views/products/components/ProductTable.vue apps/admin-web/src/views/products/components/ProductTable.spec.ts apps/admin-web/src/views/products/ProductsView.vue apps/admin-web/src/views/products/ProductsView.spec.ts apps/admin-web/src/views/products/index.ts
rg -n 'fetch\(|productsApi' apps/admin-web/src/views/products/components
```

预期：diff check 无输出；组件目录不命中网络访问。

---

### 任务 10：实现商品编辑 hook、表单与页面

**文件：**
- 新建：`apps/admin-web/src/views/products/config/defaults.ts`
- 修改：`apps/admin-web/src/views/products/type/form.ts`
- 新建：`apps/admin-web/src/views/products/mock/detail.mock.ts`
- 新建：`apps/admin-web/src/views/products/hooks/useProductEditor.ts`
- 新建：`apps/admin-web/src/views/products/hooks/useProductEditor.spec.ts`
- 新建：`apps/admin-web/src/views/products/components/ProductForm.vue`
- 新建：`apps/admin-web/src/views/products/components/ProductForm.spec.ts`
- 新建：`apps/admin-web/src/views/products/ProductEditorView.vue`
- 新建：`apps/admin-web/src/views/products/ProductEditorView.spec.ts`

**接口：**
- 消费：`productsApi`、`categoriesApi`、任务 8 组件/表单类型、共享 `AdminProductDetailView`/`SaveProductRequest`、`ApiClientError`。
- 产出：`mapDetailToForm`、`mapFormToRequest`、`validateProductForm`、`useProductEditor(mode)`；保存响应覆盖表单和 `savedPreviewHtml`；409 保留草稿并提供 reload。

- [ ] **步骤 1：写纯映射与状态机 RED 测试**

`useProductEditor.spec.ts` 至少包含：

```ts
it('maps detail to form and submits exact integer-cent aggregate input', async () => {
  api.getOne.mockResolvedValue(detailMock);
  categoriesApi.list.mockResolvedValue(categoryListMock);
  const editor = useProductEditor({ mode: 'edit', productId: 'product-1' });
  await editor.load();

  expect(editor.form.skus[0]).toMatchObject({
    id: 'sku-1', stockVersion: 4, priceYuan: '68.50', stock: 0,
  });
  await editor.save();
  expect(api.replace).toHaveBeenCalledWith('product-1', expect.objectContaining({
    skus: [expect.objectContaining({
      id: 'sku-1', stockVersion: 4, priceCents: 6850, stock: 0,
    })],
    deletedSkuIds: [],
  }));
});

it('keeps the draft on 409 and reloads only after explicit action', async () => {
  api.replace.mockRejectedValueOnce(new ApiClientError(409,
    '库存已发生变化，请重新加载后再保存',
    { code: ApiErrorCode.PRODUCT_STOCK_CONFLICT },
  ));
  const editor = loadedEditor();
  editor.setName('未保存草稿');
  await expect(editor.save()).rejects.toThrow();
  expect(editor.form.name).toBe('未保存草稿');
  expect(editor.stockConflict.value).toBe(true);
  expect(api.getOne).not.toHaveBeenCalled();
  await editor.reload();
  expect(api.getOne).toHaveBeenCalledWith('product-1');
});

it('uses the server response as form and sanitized preview', async () => {
  api.create.mockResolvedValue({ ...detailMock, detailHtml: '<p>clean</p>' });
  const editor = newEditor();
  await editor.save();
  expect(editor.form.detailHtml).toBe('<p>clean</p>');
  expect(editor.savedPreviewHtml.value).toBe('<p>clean</p>');
});
```

另测：分类与详情通过 `Promise.all` 并行；下架零 SKU通过；上架无启用 SKU失败；上传中禁止保存；名称/分类/价格/库存/属性错误在 API 前失败。

- [ ] **步骤 2：写表单和页面 RED 测试并运行**

`ProductForm.spec.ts` 断言九类字段与子组件都存在、组件只 emit，不请求 API。`ProductEditorView.spec.ts` 断言 loading/error/retry、创建/编辑标题、409 提示和“重新加载”、保存成功后预览只展示 server response。运行：

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/products/hooks/useProductEditor.spec.ts src/views/products/components/ProductForm.spec.ts src/views/products/ProductEditorView.spec.ts
```

预期：FAIL，hook/form/page/default/detail mock 尚不存在。

- [ ] **步骤 3：补全 form type 和默认值**

在 `type/form.ts` 追加：

```ts
export type ProductFormShape = {
  readonly name: string;
  readonly summary: string;
  readonly categoryId: string;
  readonly coverImage: MediaAsset | null;
  readonly images: readonly ProductImageFormRow[];
  readonly detailHtml: string;
  readonly skus: readonly SkuFormRow[];
  readonly sortOrder: number;
  readonly isActive: boolean;
};
```

`defaults.ts` 导出 `createDefaultProductForm(): ProductFormShape`，每次返回新数组/对象，默认下架、零 SKU、`sortOrder: 0`。`detail.mock.ts` 是完整 `AdminProductDetailView`，必须含服务端 HTML、轮播图和 `stockVersion`。

- [ ] **步骤 4：实现纯映射和校验**

`mapDetailToForm` 保留图片 id、SKU id/version，属性用 `Object.entries(...).map`；元显示用 `formatCentsToYuan`。`mapFormToRequest` trim 文本、轮播图映射为 `SaveProductImageInput`、SKU 通过任务 8 的合法转换，固定 `deletedSkuIds: []`。价格解析使用字符串拆分，不使用浮点乘法。

`validateProductForm` 返回 `readonly string[]`：名称/分类必填；sortOrder 非负整数；所有 SKU 字段合法；已有 SKU有版本、新 SKU无版本；`isActive` 时至少一个 `isActive` SKU；上传中额外阻止保存。错误数组不可变累积，禁止参数就地修改。

- [ ] **步骤 5：实现 editor hook**

`load()` 在 edit 模式执行：

```ts
const [categories, detail] = await Promise.all([
  categoriesApi.list(),
  productsApi.getOne(productId),
]);
```

new 模式只加载分类。`save()` 根据 mode 调 `create` 或 `replace`；成功用 `replaceForm(mapDetailToForm(response))` 覆盖本地并设置 `savedPreviewHtml=response.detailHtml`。只在 `error instanceof ApiClientError && error.status === 409 && error.code === PRODUCT_STOCK_CONFLICT` 时设置 `stockConflict=true`，绝不自动 reload/merge。`reload()` 明确丢弃当前草稿并重新请求。

- [ ] **步骤 6：实现纯表单与页面边界**

`ProductForm` 接收 form、categories、saving、uploading，组合 `CosImageUploader`、`ProductImagesEditor`、`RichTextEditor`、`SkuTableEditor`，所有更新 emit 新 `ProductFormShape`；保存按钮在 saving/uploading 禁用。页面读取 route mode/id，调用 hook；用 `ElMessage` 处理成功和普通错误；409 显示固定文案与 reload 按钮；保存后预览使用 `savedPreviewHtml` 的 `v-html`，不得预览未保存 `form.detailHtml`。

- [ ] **步骤 7：运行 GREEN**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/products/hooks/useProductEditor.spec.ts src/views/products/components/ProductForm.spec.ts src/views/products/ProductEditorView.spec.ts
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/admin-web typecheck
```

预期：映射、创建、替换、server response 覆盖、409 保留草稿、上传门禁和表单规则全部 PASS。

- [ ] **步骤 8：检查任务 diff，不提交**

```bash
git diff --check -- apps/admin-web/src/views/products/config/defaults.ts apps/admin-web/src/views/products/type/form.ts apps/admin-web/src/views/products/mock/detail.mock.ts apps/admin-web/src/views/products/hooks/useProductEditor.ts apps/admin-web/src/views/products/hooks/useProductEditor.spec.ts apps/admin-web/src/views/products/components/ProductForm.vue apps/admin-web/src/views/products/components/ProductForm.spec.ts apps/admin-web/src/views/products/ProductEditorView.vue apps/admin-web/src/views/products/ProductEditorView.spec.ts
rg -n 'deleteSku|deletedSkuIds: \[[^\]]|updateProduct|createSku|Math\.round' apps/admin-web/src/views/products
```

预期：diff check 无输出；新页面只发送空 `deletedSkuIds`，不调用旧 CRUD，不使用浮点元转分。

---

### 任务 11：接通路由、鉴权与布局标题

**文件：**
- 修改：`apps/admin-web/src/router/index.ts`
- 修改：`apps/admin-web/src/router/index.spec.ts`
- 修改：`apps/admin-web/src/layouts/AdminLayout.vue`
- 新建：`apps/admin-web/src/layouts/AdminLayout.spec.ts`

**接口：**
- 消费：任务 9 `ProductsView.vue`、任务 10 `ProductEditorView.vue`、既有父路由 `requiresAdminAuth` guard。
- 产出：`/products`、`/products/new`、`/products/:id/edit` 三个受保护 route record；布局从 matched meta 读取中文标题。

- [ ] **步骤 1：写路由与布局 RED 测试**

扩展 `router/index.spec.ts`：

```ts
it.each([
  ['/products', 'admin-products', '商品管理'],
  ['/products/new', 'admin-product-new', '新建商品'],
  ['/products/product-1/edit', 'admin-product-edit', '编辑商品'],
])('resolves %s to a protected real view', async (path, name, title) => {
  const resolved = router.resolve(path);
  expect(resolved.name).toBe(name);
  expect(resolved.meta.requiresAdminAuth).toBe(true);
  expect(resolved.meta.title).toBe(title);
});
```

`AdminLayout.spec.ts` 用 memory router 进入 `/products/product-1/edit`，断言 `[data-testid="admin-page-title"]` 为 `编辑商品` 而非 `概览`。

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/router/index.spec.ts src/layouts/AdminLayout.spec.ts
```

预期：FAIL；当前只有 `/products` placeholder，new/edit 被 catch-all 接收，布局按完整 path 查 NAV_ITEMS 后回退“概览”。

- [ ] **步骤 3：增加三个 route record 和 meta type**

按静态路径优先顺序配置：

```ts
{
  path: 'products',
  name: 'admin-products',
  component: () => import('../views/products/ProductsView.vue'),
  meta: { title: '商品管理' },
},
{
  path: 'products/new',
  name: 'admin-product-new',
  component: () => import('../views/products/ProductEditorView.vue'),
  meta: { title: '新建商品' },
},
{
  path: 'products/:id/edit',
  name: 'admin-product-edit',
  component: () => import('../views/products/ProductEditorView.vue'),
  meta: { title: '编辑商品' },
},
```

父记录的 `requiresAdminAuth` 必须继续通过 matched meta 合并到三个子路由。扩展 `RouteMeta`：`title?: string`。

- [ ] **步骤 4：让布局从 route meta/matched record 取标题**

```ts
const pageTitle = computed(() => {
  const matchedTitle = [...route.matched]
    .reverse()
    .map((record) => record.meta.title)
    .find((title): title is string => typeof title === 'string');
  return matchedTitle ?? NAV_ITEMS.find(({ path }) => path === route.path)?.label ?? '概览';
});
```

模板给标题 span 加 `data-testid="admin-page-title"` 并显示 `pageTitle`。侧栏 active path 对 new/edit 归一到 `/products`，保证商品菜单高亮。

- [ ] **步骤 5：运行 GREEN**

```bash
pnpm --filter @bake-mall/admin-web test -- src/router/index.spec.ts src/layouts/AdminLayout.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
```

预期：三路由、继承 guard、标题和菜单高亮测试 PASS。

- [ ] **步骤 6：检查任务 diff，不提交**

```bash
git diff --check -- apps/admin-web/src/router/index.ts apps/admin-web/src/router/index.spec.ts apps/admin-web/src/layouts/AdminLayout.vue apps/admin-web/src/layouts/AdminLayout.spec.ts
```

预期：无输出；categories、banners、orders 路由未被意外替换，catch-all 仍在最后。

---

### 任务 12：让 H5 精确消费 Public DTO

**文件：**
- 修改：`apps/h5-store/src/api/catalog.ts`
- 修改：`apps/h5-store/src/views/catalog/type/index.ts`
- 修改：`apps/h5-store/src/views/catalog/mock/catalog.mock.ts`
- 修改：`apps/h5-store/src/views/catalog/hooks/useCatalog.ts`
- 修改：`apps/h5-store/src/views/catalog/hooks/useCatalog.spec.ts`
- 新建：`apps/h5-store/src/views/catalog/components/ProductCard.spec.ts`
- 修改：`apps/h5-store/src/views/catalog/components/ProductCard.vue`
- 修改：`apps/h5-store/src/views/ProductDetailView.spec.ts`
- 校验：`apps/h5-store/src/views/ProductDetailView.vue`
- 校验：`apps/h5-store/src/components/SkuPicker.spec.ts`

**接口：**
- 消费：任务 1 Public DTO、任务 4 后端显式响应。
- 产出：H5 列表不再把 detail 字段标 optional 来适配 Entity；有库存且 `isAvailable=true` 的 SKU 可选；最低价只取可售 SKU；详情展示清洗 HTML。

- [ ] **步骤 1：写真实 Public 形态 RED 测试**

更新 catalog mock 为完整 summary 数组，每个商品必须有 `skus`。新增 `ProductCard.spec.ts`：一个可售 SKU `6800`、一个零库存 `5800`、一个下架 `4800`，断言卡片显示 `¥68.00 起` 而不是最低原始价格。扩展 `ProductDetailView.spec.ts`：

```ts
const detail: PublicProductDetailView = {
  id: 'product-1', categoryId: 'cake', name: '草莓云朵蛋糕',
  detailHtml: '<p>服务端清洗后的商品详情</p>', images: [],
  skus: [
    { id: 'sku-live', name: '6寸', attributes: {}, priceCents: 6800,
      stock: 3, isAvailable: true },
    { id: 'sku-zero', name: '8寸', attributes: {}, priceCents: 8800,
      stock: 0, isAvailable: false },
  ],
};
```

打开 action sheet 后断言 `sku-live` 可点击、`sku-zero` disabled，详情 HTML 存在。`useCatalog.spec.ts` 断言 `getProduct` 的 detail 不经 cast 保存。

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/h5-store test -- src/views/catalog/components/ProductCard.spec.ts src/views/catalog/hooks/useCatalog.spec.ts src/views/ProductDetailView.spec.ts src/components/SkuPicker.spec.ts
```

预期：至少 ProductCard 新测试或类型检查 FAIL；现 API 用扩宽 `ProductListItem` 允许省略 SKU/images，mock 也没有真实 Public SKU，无法锁住服务端闭环。

- [ ] **步骤 3：收紧 API 和页面类型**

`apps/h5-store/src/api/catalog.ts` 删除本地 `ProductListItem`，直接实现：

```ts
listProducts(
  params: { categoryId?: string; q?: string } = {},
): Promise<PublicProductSummaryView[]>;

getProduct(id: string): Promise<PublicProductDetailView>;
```

`views/catalog/type/index.ts` 改为：

```ts
export type CatalogProduct = PublicProductSummaryView;
export type CatalogProductDetail = PublicProductDetailView;
```

`useCatalog.loadProduct` 删除 `as CatalogProductDetail`。mock 列表不含 `detailHtml/images`，detail fixture 单独为完整 detail，二者严格满足共享 DTO。

- [ ] **步骤 4：使用纯最低价计算并复核详情**

在 `ProductCard.vue` 使用 computed 或命名纯函数：

```ts
function minimumAvailablePriceCents(product: CatalogProduct): number | null {
  const prices = product.skus
    .filter(({ isAvailable, stock }) => isAvailable && stock > 0)
    .map(({ priceCents }) => priceCents);
  return prices.length > 0 ? Math.min(...prices) : null;
}
```

`ProductDetailView.vue` 保持 `v-html` 只渲染 `catalog.product.value.detailHtml`；不得读取 `isActive`、`coverImageObjectKey`、`imageObjectKey` 或 category relation。`SkuPicker` 继续同时检查 `isAvailable && stock > 0`。

- [ ] **步骤 5：运行 GREEN**

```bash
pnpm --filter @bake-mall/h5-store test -- src/views/catalog/components/ProductCard.spec.ts src/views/catalog/hooks/useCatalog.spec.ts src/views/ProductDetailView.spec.ts src/components/SkuPicker.spec.ts
pnpm --filter @bake-mall/h5-store typecheck
pnpm --filter @bake-mall/h5-store build
```

预期：可售最低价、可选/不可选 SKU 和清洗 HTML 测试 PASS；H5 不再有扩宽 Entity 响应的本地类型。

- [ ] **步骤 6：检查任务 diff，不提交**

```bash
git diff --check -- apps/h5-store/src/api/catalog.ts apps/h5-store/src/views/catalog/type/index.ts apps/h5-store/src/views/catalog/mock/catalog.mock.ts apps/h5-store/src/views/catalog/hooks/useCatalog.ts apps/h5-store/src/views/catalog/hooks/useCatalog.spec.ts apps/h5-store/src/views/catalog/components/ProductCard.vue apps/h5-store/src/views/catalog/components/ProductCard.spec.ts apps/h5-store/src/views/ProductDetailView.spec.ts
rg -n 'ProductListItem|isActive|ObjectKey|category\.' apps/h5-store/src/api/catalog.ts apps/h5-store/src/views/catalog apps/h5-store/src/views/ProductDetailView.vue
```

预期：diff check 无输出；没有 Entity 内部字段或旧扩宽类型命中。

---

### 任务 13：执行全量质量门与真实验收

**文件：**
- 验证：任务 1 至任务 12 的全部变更文件。
- 仅在检查暴露已确认缺陷时修改对应现有实现/测试文件；不得修改 `.claude/CLAUDE.md`，不得创建总结文档。

**接口：**
- 消费：完整共享契约、API、Admin、H5 垂直切片和本地 `pnpm dev` 基础设施。
- 产出：全量静态/测试/build 证据、真实数据库迁移证据、浏览器/API 验收记录、环境清理结果。

- [ ] **步骤 1：执行验收 RED 基线，确认环境尚未就绪时明确失败**

先不要启动服务，运行：

```bash
curl -fsS http://127.0.0.1:3015/health
```

预期：若本分支服务尚未运行，命令以连接失败退出；这就是验收 RED，证明后续结果不是 mock 测试冒充真实服务。若已有服务复用且返回成功，记录其 PID/分支 Compose project，并继续用 `pnpm services:ps` 证明服务归属，不人为制造失败。

- [ ] **步骤 2：运行所有聚焦回归**

```bash
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/api test -- src/database/migrations/0004-sku-stock-version.spec.ts src/orders/orders.service.spec.ts src/catalog/product.mapper.spec.ts src/catalog/media-asset-policy.service.spec.ts src/content/html-sanitizer.service.spec.ts src/catalog/catalog.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- catalog.e2e-spec.ts
pnpm --filter @bake-mall/admin-web test -- src/api/http.spec.ts src/views/products/api/index.spec.ts src/views/products/hooks/useSkuEditor.spec.ts src/views/products/hooks/useProductsList.spec.ts src/views/products/hooks/useProductEditor.spec.ts src/views/products/components/ProductTable.spec.ts src/views/products/components/ProductForm.spec.ts src/views/products/components/ProductImagesEditor.spec.ts src/views/products/components/SkuTableEditor.spec.ts src/views/products/ProductsView.spec.ts src/views/products/ProductEditorView.spec.ts src/router/index.spec.ts src/layouts/AdminLayout.spec.ts
pnpm --filter @bake-mall/h5-store test -- src/views/catalog/components/ProductCard.spec.ts src/views/catalog/hooks/useCatalog.spec.ts src/views/ProductDetailView.spec.ts src/components/SkuPicker.spec.ts
```

预期：全部退出码 0；若任一失败，使用 `superpowers:systematic-debugging` 找根因，只修确认缺陷并从最窄测试重新 GREEN。

- [ ] **步骤 3：运行全仓质量门**

每条独立运行并保留退出码：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

预期：五条命令退出码均为 0。不得通过忽略规则、放宽类型或删除断言绕过失败；与本切片无关的预存失败要记录精确命令和首个错误，不得声称全绿。

- [ ] **步骤 4：启动真实服务并应用真实迁移**

运行：

```bash
pnpm services:up
pnpm --filter @bake-mall/api migration:run
pnpm dev
```

`pnpm dev` 在前台保持运行；预期 MySQL/MinIO 使用当前分支隔离 Compose project，迁移表出现 `SkuStockVersion1718000000003`，API `3015`、H5 `5173`、Admin `5174` 可访问。另开终端查询：

```bash
pnpm services:ps
curl -fsS http://127.0.0.1:3015/health
```

预期：容器 healthy，health 返回 2xx。不得在 migration 未成功时继续宣称真实验收。

- [ ] **步骤 5：按顺序完成真实浏览器与 API 验收**

调用仓库 `run` skill 驱动真实 Admin/H5；使用本地 Admin `admin-local@example.com / admin-password` 和 H5 `13800000000 / 123456`。逐项观察并记录：

1. Admin `/products/new` 新建一个下架、零 SKU 草稿；保存后重新打开，字段完整恢复。
2. 添加主图、两张轮播图、含允许 MinIO 图片的富文本、两个 SKU；第一个有库存，第二个启用但库存为 `0`；上架保存成功。
3. 重新打开编辑页，图片顺序、完整 `MediaAsset`、属性、整数分价格、库存、`stockVersion` 全部恢复；预览只显示 POST/PUT 返回的清洗 HTML。
4. H5 列表显示最低可售价格；详情中有库存 SKU 可选，零库存 SKU disabled；详情呈现服务端清洗 HTML。
5. 保持旧 Admin 编辑页不刷新；通过真实 H5 购物车下单扣减第一个 SKU 库存；回到旧页保存，必须收到 HTTP `409 PRODUCT_STOCK_CONFLICT`，当前草稿保留并出现“重新加载”。
6. 读取 Admin 详情确认商品主记录、图片、其他 SKU没有部分更新；点击重新加载得到新库存/版本，再保存成功。
7. 在编辑器移除已有 SKU并保存；再次读取详情确认该 SKU仍存在且 `isActive=false`；已有购物车关联没有因数据库级联被物理删除，结算由不可售校验拒绝。
8. 富文本插入未配置主机图片与开发 MinIO 图片；保存后前者被移除、后者保留。
9. 直接构造带其他商品 SKU id 或图片 id 的 PUT，分别确认 HTTP `422 PRODUCT_ASSET_OWNERSHIP_INVALID`，目标和来源商品都未变化。

并调用仓库 `verify` skill 对 `/products`、`/products/new`、`/products/:id/edit` 与 H5 商品详情执行端到端观察；单元测试不能替代这一步。

- [ ] **步骤 6：清理验收数据并做最终自审**

通过正式 Admin DELETE 删除验收临时商品；清理本次上传的临时对象，恢复测试环境。然后运行：

```bash
git diff --check
rg -n 'T[B]D|T[O]DO|implement[[:space:]]+later|fill[[:space:]]+in[[:space:]]+details|类似任务[[:space:]]*[0-9]+' docs/superpowers/plans/2026-07-17-admin-product-sku-management.md
git status --short
```

预期：前两条无输出；`git status --short` 只列出实施范围内文件以及执行前已经存在的 `.claude/CLAUDE.md` 和已批准规格修改，不出现凭据、构建产物或临时验收文件。

- [ ] **步骤 7：请求审查并报告，不提交**

调用 `superpowers:requesting-code-review`，重点检查：共享 DTO 是否唯一、库存版本是否在三类更新路径递增、409 是否全事务回滚、资产归属、Public 白名单、已有 SKU 下架语义、上传中保存门禁、服务端预览和 H5 可售判断。只修已确认问题并重跑受影响聚焦测试与全量质量门。

最终报告只包含：完成状态、变更范围、聚焦/全量/真实验收结果、任何阻塞或 concerns。保持工作树未提交，不覆盖 `.claude/CLAUDE.md` 的用户修改。
