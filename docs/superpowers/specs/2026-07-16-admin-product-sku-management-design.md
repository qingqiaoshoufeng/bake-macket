# Admin 商品与 SKU 管理设计

**状态：** 已批准

## 1. 背景

MVP Task 12 的分类管理已经完成，但 Admin `/products` 仍为占位页。仓库已经具备商品聚合保存、SKU 编辑器、富文本编辑器和对象存储上传基础，但前后端仍处于两代契约并存状态：

- Admin 前端使用旧商品/SKU CRUD 类型，尚未调用聚合 `GET/POST/PUT`。
- 公开商品 API 直接序列化 Entity，未输出 H5 依赖的 `SkuView.isAvailable`，真实 SKU 会被 H5 视为不可选。
- 聚合更新未校验 SKU/商品图归属，可能将其他商品资产重新绑定。
- 管理员加载编辑页后，顾客下单可能改变库存；当前全量保存会用旧库存覆盖最新库存。
- 物理删除 SKU 会级联删除购物车项。

本设计将 Admin 商品列表与编辑页面、必要后端契约修复和 H5 可售闭环作为同一个垂直切片交付。

## 2. 目标

1. Admin 提供真实商品列表、新建页和编辑页。
2. 支持商品名称、简介、分类、主图、轮播图、富文本、排序、状态和多 SKU。
3. SKU 支持属性、整数分价格、非负库存、图片、状态和库存版本。
4. 商品聚合保存具备事务、归属校验和库存乐观并发控制。
5. 下架商品草稿允许零 SKU；上架时至少一个启用 SKU。
6. 已存在 SKU 的“删除”转为下架，不物理删除购物车关联。
7. 公开 API 显式返回共享 DTO，H5 能正确判断可售 SKU。
8. 保存后预览服务端清洗后的富文本，而不是本地未清洗草稿。
9. 开发 MinIO 与生产 COS/CDN 都能按配置通过富文本图片白名单。

## 3. 非目标

- 不实现 Banner、订单或小程序页面。
- 不实现 SKU 人工排序；当前 SKU 顺序沿用服务端顺序。
- 不删除旧商品 `PATCH` 和独立 SKU CRUD 兼容接口，但新页面不得调用它们。
- 不实现独立库存调整工作台。
- 不改变历史订单快照。
- 不引入第三方富文本编辑器。

## 4. 共享契约

### 4.1 Admin SKU 库存版本

`AdminSkuView` 增加：

```ts
stockVersion: number;
```

已有 SKU 的聚合保存输入必须携带加载时版本：

```ts
export type SaveProductSkuInput = {
  id?: string;
  stockVersion?: number;
  name: string;
  attributes: Record<string, string>;
  priceCents: number;
  stock: number;
  isActive: boolean;
  image: MediaAsset | null;
};
```

规则：

- 新 SKU 不带 `id` 和 `stockVersion`。
- 已有 SKU 同时带 `id` 与 `stockVersion`。
- 请求形态不符合该组合时由 DTO 校验拒绝。

### 4.2 公开商品 DTO

公开列表和详情必须使用显式共享类型，不再直接返回 Entity。列表和详情分离：

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
```

`SkuView.isAvailable` 由服务端明确输出，定义为：

```text
商品启用 && 分类启用 && SKU 启用 && stock > 0
```

H5 不读取 Entity 的 `isActive` 或对象存储内部键。

### 4.3 API 错误码

共享 `ApiErrorCode` 增加：

```text
PRODUCT_STOCK_CONFLICT
PRODUCT_ASSET_OWNERSHIP_INVALID
```

库存冲突返回 HTTP `409`；SKU/图片归属无效返回 HTTP `422`。

## 5. 数据库与并发控制

### 5.1 SKU 版本列

新增迁移为 `skus` 添加：

```sql
stock_version INT UNSIGNED NOT NULL DEFAULT 1
```

实体使用 `@VersionColumn` 或等价显式版本列。版本必须在以下库存变更中递增：

- 管理员聚合保存已有 SKU；
- 顾客下单条件扣减库存；
- 旧兼容 SKU 更新接口修改库存。

### 5.2 后台聚合保存

在单个事务中：

1. 校验分类存在。
2. PUT 时校验商品存在。
3. 读取该商品全部已有 SKU 与图片。
4. 所有请求中带 ID 的 SKU/图片必须属于该商品；否则事务回滚并返回 `422`。
5. 保存商品主记录和清洗后的 `detailHtml`。
6. 更新图片顺序与媒体信息。
7. 对每个已有 SKU 执行条件更新：

```sql
WHERE id = :id
  AND product_id = :productId
  AND stock_version = :stockVersion
```

并执行：

```sql
stock_version = stock_version + 1
```

8. 任一条件更新未命中一行，整笔事务回滚并返回 `409 PRODUCT_STOCK_CONFLICT`。
9. 插入新 SKU，初始版本为 `1`。
10. 保存审计记录。
11. 返回最新 `AdminProductDetailView`。

### 5.3 订单扣库存

订单现有条件扣减改为同时递增 `stock_version`：

```sql
stock = stock - :quantity,
stock_version = stock_version + 1
```

库存不足与下架逻辑保持不变。

### 5.4 SKU 删除语义

新 Admin 页面：

- 未保存的新 SKU：直接从草稿移除。
- 已存在 SKU：保留在提交数组中，设置 `isActive=false`。
- 不产生 `deletedSkuIds`。

后端保留 `deletedSkuIds` 兼容字段，但新页面不使用。这样现有购物车项不因物理删除而消失；结算时由现有 SKU 可售校验拒绝下架项。

## 6. 后端映射与校验

### 6.1 Admin 列表

`GET /admin/products` 返回 `AdminProductSummaryView[]`，包含：

- 分类名；
- 完整主图 `MediaAsset | null`；
- 启用 SKU 数；
- ISO 时间；
- 商品排序和状态。

### 6.2 Admin 详情

`GET /admin/products/:id` 返回：

- 服务端清洗后的 `detailHtml`；
- 有序轮播图；
- 全部 SKU 及其 `stockVersion`；
- 不泄漏 Entity 关系对象。

### 6.3 Public 映射

新增纯映射函数：

- `toAdminProductSummaryView`
- `toAdminProductDetailView`
- `toPublicProductSummaryView`
- `toPublicProductDetailView`
- `toPublicSkuView`

公开响应不得包含：

- `coverImageObjectKey`
- `imageObjectKey`
- Entity `isActive`
- category relation
- 非共享契约字段

### 6.4 媒体资产校验

聚合保存端点校验：

- 商品媒体 `objectKey` 必须位于 `products/` 作用域。
- `publicUrl` 必须匹配配置的对象存储/CDN 主机。
- 带 ID 图片必须属于当前商品。
- 不接受把其他商品图片 ID 重新归属。

MVP 不新增对象存储 HEAD 确认接口；上传成功和作用域/主机校验作为本切片边界。

### 6.5 富文本白名单

`HtmlSanitizerService` 不再硬编码腾讯 COS 正则，而从类型化配置读取允许主机：

- 开发：本地 MinIO 公网地址；
- 生产：COS/CDN 主机列表。

仍只允许安全标签、属性和 `https`；开发环境明确允许配置的 `http://127.0.0.1:*` MinIO 地址。任意其他主机图片被移除。

## 7. Admin 前端架构

### 7.1 路由

```text
/products              商品列表
/products/new          新建商品
/products/:id/edit     编辑商品
```

三个路由均受 Admin guard 保护。`AdminLayout` 从 route meta/matched record 获取标题，编辑页不回退为“概览”。

### 7.2 目录结构

```text
views/products/
├── ProductsView.vue
├── ProductEditorView.vue
├── index.ts
├── api/index.ts
├── components/
│   ├── ProductTable.vue
│   ├── ProductForm.vue
│   ├── ProductImagesEditor.vue
│   └── SkuTableEditor.vue
├── hooks/
│   ├── useProductsList.ts
│   ├── useProductEditor.ts
│   └── useSkuEditor.ts
├── config/
│   ├── columns.ts
│   └── defaults.ts
├── type/form.ts
└── mock/
    ├── list.mock.ts
    └── detail.mock.ts
```

### 7.3 API 层

全局 `ApiClient` 增加：

```ts
put<T>(path: string, body?: unknown): Promise<T>
```

商品域 API 只组合全局客户端：

```ts
list(): Promise<AdminProductSummaryView[]>
getOne(id: string): Promise<AdminProductDetailView>
create(body: SaveProductRequest): Promise<AdminProductDetailView>
replace(id: string, body: SaveProductRequest): Promise<AdminProductDetailView>
remove(id: string): Promise<void>
```

跨边界 DTO 直接从 `@bake-mall/contracts` 导入，不再重复定义商品/SKU wire types。旧兼容方法可暂留在全局 API，但新商品页面不得调用。

### 7.4 商品列表

列表显示：

- 名称；
- 分类；
- 主图；
- 启用 SKU 数；
- 排序；
- 上架状态；
- 操作。

操作：

- 新增；
- 编辑；
- 删除并确认；
- 加载失败重试。

列表不内联编辑复杂商品字段。

### 7.5 商品编辑状态

`useProductEditor` 负责：

- 并行加载分类和商品详情；
- DTO → 表单映射；
- 表单 → `SaveProductRequest` 映射；
- 表单校验；
- 新建/更新；
- 保存响应覆盖本地表单；
- `savedPreviewHtml`；
- `409` 冲突状态与重新加载。

页面只负责组合视图、导航和消息提示。

## 8. 表单与组件

### 8.1 ProductForm

字段：

- 名称；
- 简介；
- 分类；
- 主图；
- 轮播图；
- 富文本详情；
- SKU；
- 排序；
- 上架状态。

组件不直接请求 API。

### 8.2 SKU 编辑器

页面内部 SKU 行包含：

```ts
id?: string;
stockVersion?: number;
name: string;
attributes: Array<{ key: string; value: string }>;
priceYuan: string;
stock: number;
isActive: boolean;
image: MediaAsset | null;
```

校验：

- 名称非空；
- 价格最多两位小数，转换为非负整数分；
- 库存必须为非负整数，允许 `0`；
- 属性键非空且不重复；
- 已有 SKU 必须保留 `stockVersion`；
- 新 SKU 不携带版本。

父级详情变化时按完整内容同步，而非只比较数组长度和 ID。

### 8.3 媒体组件

`CosImageUploader` 的持久化接口统一为：

```ts
modelValue: MediaAsset | null;
update: modelValue: [MediaAsset | null];
```

用途：

- 商品主图；
- 轮播图；
- SKU 图。

上传成功写入完整 `objectKey + publicUrl`；清空写入 `null`。不得以手工 URL 作为商品持久化主接口。

`ProductImagesEditor` 管理轮播图片添加、删除和 `sortOrder`，已存在图片保留服务端 ID。

### 8.4 富文本组件

修复已有 HTML 初始化，使 `modelValue` 作为编辑器 HTML 内容，而非标签源码文本。

预览分为：

- 编辑草稿：仅编辑器内部使用；
- 服务端清洗后预览：只使用最近一次 `POST/PUT` 返回的 `detailHtml`。

## 9. 业务规则与错误处理

### 9.1 草稿与上架

- 下架商品允许零 SKU 保存。
- 上架商品至少一个启用 SKU。
- 启用 SKU 可以库存为 `0`，但 H5 `isAvailable=false`。
- 保存时所有 SKU 都必须满足字段格式要求。

### 9.2 库存冲突

收到 `409 PRODUCT_STOCK_CONFLICT`：

- 保留当前草稿；
- 显示“库存已发生变化，请重新加载后再保存”；
- 提供“重新加载”操作；
- 不自动合并或覆盖。

### 9.3 其他错误

- 列表/详情加载失败：页面级错误与重试。
- `422` 归属错误：显示服务端消息，保留草稿。
- 上传失败：保留原媒体，允许重试。
- 上传进行中：禁止保存。
- 商品删除失败：保留列表项并显示错误。

## 10. 测试策略

### 10.1 共享契约

覆盖：

- `stockVersion` 类型约束；
- 新/旧 SKU 保存输入组合；
- Admin/Public 商品 DTO；
- 新错误码。

### 10.2 API

单元与 e2e 覆盖：

- Admin 列表/详情显式映射；
- Public 字段白名单和 `isAvailable`；
- SKU/图片归属校验；
- 库存版本匹配成功与 `409` 回滚；
- 订单扣库存递增版本；
- 下架草稿零 SKU；
- 上架至少一个启用 SKU；
- 已存在 SKU 下架而非物理删除；
- 富文本允许开发 MinIO、允许配置的 COS/CDN、拒绝其他主机。

### 10.3 Admin

覆盖：

- `ApiClient.put`；
- 商品 API 路径与 DTO；
- 列表加载、删除和错误重试；
- 详情映射、创建、更新、保存响应覆盖；
- 409 保留草稿并提示重新加载；
- 价格两位精度、零库存、整数库存、属性、媒体；
- 已有 SKU 删除转下架；
- 路由、标题和页面装配；
- RichTextEditor 初始 HTML；
- CosImageUploader 完整 `MediaAsset`。

### 10.4 H5

覆盖：

- 真实 Public DTO 中有库存启用 SKU 可选；
- 零库存/下架 SKU 不可选；
- 商品卡显示最低可售价格；
- 详情渲染服务端清洗 HTML。

## 11. 真实验收

1. 管理员新建下架零 SKU 草稿并重新打开。
2. 添加主图、轮播图、富文本和两个 SKU：一个有库存、一个零库存。
3. 上架并保存，重新打开恢复完整数据和服务端清洗预览。
4. H5 列表显示最低可售价格；详情可选有库存 SKU，不可选零库存 SKU。
5. 保持旧编辑页，模拟顾客下单扣减库存，再保存旧草稿，收到 `409` 且事务不产生部分更新。
6. 重新加载后保存成功。
7. 将已有 SKU 从编辑器“删除”，保存后 SKU 仍存在但 `isActive=false`；购物车关联不被物理级联删除。
8. 非配置主机的富文本图片被移除；开发 MinIO 图片保留。
9. 删除验收临时商品和上传资产，恢复测试环境。

## 12. 完成标准

- Admin `/products`、`/products/new`、`/products/:id/edit` 均为真实页面。
- 商品聚合保存只使用共享 DTO 与 `POST/PUT`。
- 库存冲突不会静默覆盖订单扣减。
- 跨商品 SKU/图片 ID 无法重新绑定。
- H5 SKU 可售判断与公开 DTO 正确。
- 已有 SKU 删除不物理删除购物车关联。
- 服务端清洗预览与媒体主机配置正确。
- 共享契约、API、Admin、H5 的目标测试、lint、typecheck、build 全部通过。
- 真实浏览器与 API 验收完成。
- 所有需求、计划、报告和验收记录使用中文。
