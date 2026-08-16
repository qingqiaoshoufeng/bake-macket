# 首页多草稿与 H5 内容边界实施计划

> **供智能体执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项实施；所有步骤使用复选框跟踪。

**目标：** 让 H5 `/` 严格只渲染后台已发布的首页装修配置，并将后台首页装修从单一覆盖式草稿升级为可创建、切换、重命名、删除和指定发布的多草稿工作区。

**架构：** 保留 `homepage_pages` 作为唯一 `HOME` 发布聚合根和不可变线上快照，新建 `homepage_drafts` 保存多套可编辑草稿。发布时在同一事务内锁定发布聚合根和目标草稿，严格校验后复制草稿配置到 `published_config`，并记录来源草稿及来源版本；H5 Public API 始终只读取聚合根的已发布快照。Admin `/homepage` 保持一个工作区，采用“左侧草稿列表 + 中间当前草稿编辑 + 右侧手机预览”，不拆成跳转式列表页。

**技术栈：** pnpm workspace、TypeScript、Vue 3、Vite、Element Plus、Vant 4、NestJS 11、TypeORM、MySQL 8.4、Vitest。

---

## 已确认的产品规则

1. H5 `/` 只显示后台装修中的轮播、客服、宫格和配图区，以及加载/失败/未发布状态和全局底部导航；Banner、分类、商品和“下一炉”只保留在 `/products`。
2. `homepage_pages` 每个 `page_key` 仍只有一个聚合根；线上配置是发布时的不可变快照，不与来源草稿保持实时引用。
3. 每套草稿独立保存名称、配置和乐观锁版本；保存一套草稿不会影响其他草稿或线上 H5。
4. 发布任意草稿后，该草稿成为当前线上来源；之后继续编辑它不会影响 H5，直至再次发布。
5. 草稿状态分为：`PUBLISHED`、`PUBLISHED_WITH_CHANGES`、`DRAFT`。
6. 当前线上来源草稿不可删除；必须先发布另一套草稿，才能删除原来源草稿。
7. 新建草稿支持“复制当前草稿”和“从空白开始”；同一首页下名称唯一。
8. 切换草稿遇到未保存改动时，必须选择“保存并切换 / 放弃修改并切换 / 取消”。
9. H5 Public API 不暴露草稿 ID、草稿名称、Admin ID、`objectKey` 或历史草稿。
10. 不修改已经落地的 `0009-homepage-pages.ts`，使用新迁移兼容升级现有数据。

## 文件职责与边界

### 新建

- `packages/shared-contracts/src/homepage.spec.ts`：多草稿运行时契约断言。
- `packages/shared-contracts/src/homepage-contracts.type-test.ts`：创建请求判别联合与非法形态类型断言。
- `apps/api/src/database/migrations/0010-homepage-multiple-drafts.ts`：把旧唯一草稿迁入新表并改造发布聚合根。
- `apps/api/src/database/migrations/0010-homepage-multiple-drafts.spec.ts`：迁移 SQL 顺序、约束和数据回填测试。
- `apps/api/src/database/entities/homepage-draft.entity.ts`：多草稿实体。
- `apps/api/src/database/entities/homepage-draft.entity.spec.ts`：实体元数据约束测试。
- `apps/api/src/homepage/dto/admin-homepage-draft-list-query.dto.ts`：分页查询 DTO。
- `apps/api/src/homepage/dto/create-homepage-draft.dto.ts`：新建草稿 DTO。
- `apps/api/src/homepage/dto/rename-homepage-draft.dto.ts`：重命名 DTO。
- `apps/api/test/homepage-drafts.e2e-spec.ts`：列表、创建、切换、保存、重命名、删除、发布和 Public 隔离 e2e。
- `apps/api/test/homepage-drafts-concurrency-mysql.e2e-spec.ts`：真实 MySQL 下并发保存与并发发布测试。
- `apps/admin-web/src/views/homepage/components/HomepageDraftSidebar.vue`：纯展示草稿列表及操作入口。
- `apps/admin-web/src/views/homepage/components/HomepageDraftCreateDialog.vue`：创建方式与名称表单。
- `apps/admin-web/src/views/homepage/hooks/useHomepageDrafts.ts`：列表、选中项、新建、重命名、删除编排。
- `apps/admin-web/src/views/homepage/hooks/useHomepageDrafts.spec.ts`：草稿列表 hook 测试。
- `apps/admin-web/src/views/homepage/hooks/useHomepageEditor.spec.ts`：按草稿 ID 加载、保存和发布测试。

### 修改

- `packages/shared-contracts/src/homepage.ts`、`enums.ts`：多草稿 DTO、状态和错误码。
- `apps/api/src/database/entities/homepage-page.entity.ts`：仅保留发布聚合根字段并关联来源草稿。
- `apps/api/src/database/entities/index.ts`、`data-source.ts`、`database.module.ts`：注册新实体和 `0010`。
- `apps/api/src/homepage/admin-homepage.controller.ts`、DTO、`homepage.service.ts`：多草稿 CRUD、指定保存/发布、事务和审计。
- `apps/admin-web/src/views/homepage/api/index.ts`、`hooks/useHomepageEditor.ts`、`HomepageEditorView.vue`、`HomepagePublishBar.vue`、mock/type/config：三栏工作区及多草稿状态。
- `apps/h5-store/src/views/homepage/HomepageView.vue`、`HomepageView.spec.ts`、`components/HomepageRenderer.vue`、router 测试：删除固定商城组合。

### 删除

- `apps/h5-store/src/views/homepage/components/HomepageCatalog.vue`
- `apps/h5-store/src/views/homepage/hooks/useHomepageCatalog.ts`
- `apps/h5-store/src/views/homepage/hooks/useHomepageCatalog.spec.ts`
- `apps/h5-store/src/views/HomeView.vue`
- `apps/h5-store/src/views/HomeView.spec.ts`

`apps/h5-store/src/views/catalog/CatalogView.vue` 及其测试不删除、不降级，它继续完整承载 `/products`。

---

### 任务 1：恢复 H5 首页的装修内容边界

**文件：**
- 修改：`apps/h5-store/src/views/homepage/HomepageView.spec.ts`
- 修改：`apps/h5-store/src/views/homepage/HomepageView.vue`
- 修改：`apps/h5-store/src/views/homepage/components/HomepageRenderer.vue`
- 修改：`apps/h5-store/src/router/index.spec.ts`
- 删除：`apps/h5-store/src/views/homepage/components/HomepageCatalog.vue`
- 删除：`apps/h5-store/src/views/homepage/hooks/useHomepageCatalog.ts`
- 删除：`apps/h5-store/src/views/homepage/hooks/useHomepageCatalog.spec.ts`
- 删除：`apps/h5-store/src/views/HomeView.vue`
- 删除：`apps/h5-store/src/views/HomeView.spec.ts`

- [ ] **步骤 1：先把首页测试改成只允许装修 API**

在 `HomepageView.spec.ts` 中移除 Banner/分类/商品 API mock，保留 `homepageApi.get`，并增加以下核心断言：

```ts
it('只加载和渲染已发布的首页装修配置', async () => {
  vi.mocked(homepageApi.get).mockResolvedValue(publishedHomepage);

  const wrapper = mountHomepage();
  await flushPromises();

  expect(homepageApi.get).toHaveBeenCalledTimes(1);
  expect(wrapper.findComponent(HomepageRenderer).props('config')).toEqual(
    publishedHomepage.config,
  );
  expect(wrapper.find('[data-homepage-catalog]').exists()).toBe(false);
  expect(wrapper.text()).not.toContain('下一炉，值得期待');
});

it('未发布时只显示准备状态和商品页入口', async () => {
  vi.mocked(homepageApi.get).mockResolvedValue(null);

  const wrapper = mountHomepage();
  await flushPromises();

  expect(wrapper.text()).toContain('首页正在准备中');
  await wrapper.get('button').trigger('click');
  expect(routerPush).toHaveBeenCalledWith('/products');
});
```

同时保留加载、失败重试、未知 schema、装修链接跳转测试。

- [ ] **步骤 2：运行失败测试，证明固定商城仍被装配**

运行：

```bash
pnpm --filter @bake-mall/h5-store test -- src/views/homepage/HomepageView.spec.ts
```

预期：测试因 `HomepageView` 仍调用 `useHomepageCatalog`、渲染 `HomepageCatalog` 或旧 mock 缺失而失败。

- [ ] **步骤 3：最小化 `HomepageView` 数据流**

将脚本收敛为单一 hook：

```ts
const router = useRouter();
const homepage = useHomepage();

function load(): Promise<void> {
  return homepage.load();
}

function navigate(link: HomepageLink): void {
  const path = homepageLinkPath(link);
  if (path) void router.push(path);
}

onMounted(() => void load());
```

模板中直接渲染 `HomepageRenderer`，并在其后按顺序处理 loading/error/null；删除 `BannerReel`、`HomepageCatalog`、catalog fallback 和 `.homepage-view__catalog`。从 `HomepageRenderer.vue` 删除 `<slot />`，确保其只能按合同顺序渲染四类装修区块。

- [ ] **步骤 4：删除失去调用方的固定首页文件并补路由断言**

在 `router/index.spec.ts` 加入：

```ts
['/', 'HomepageView'],
['/products', 'CatalogView'],
```

删除列出的五个旧文件；用搜索确认 `HomepageCatalog`、`useHomepageCatalog` 和旧 `HomeView` 不再被引用。

- [ ] **步骤 5：验证 H5 首页和商品页回归**

运行：

```bash
pnpm --filter @bake-mall/h5-store test -- \
  src/views/homepage/HomepageView.spec.ts \
  src/views/catalog/CatalogView.spec.ts \
  src/router/index.spec.ts
pnpm --filter @bake-mall/h5-store typecheck
pnpm --filter @bake-mall/h5-store lint
```

预期：全部通过；`/` 仅由装修 API 驱动，`/products` 仍保留 Banner、分类和商品。

- [ ] **步骤 6：提交 H5 边界修复**

```bash
git add apps/h5-store/src
git commit -m "fix(h5): align homepage with published decoration"
```

---

### 任务 2：定义多草稿共享契约

**文件：**
- 新建：`packages/shared-contracts/src/homepage.spec.ts`
- 新建：`packages/shared-contracts/src/homepage-contracts.type-test.ts`
- 修改：`packages/shared-contracts/src/homepage.ts`
- 修改：`packages/shared-contracts/src/enums.ts`

- [ ] **步骤 1：写运行时和类型级失败测试**

在运行时测试中固定状态、列表 envelope 和错误码：

```ts
expect(HomepageDraftStatus).toEqual({
  PUBLISHED: 'PUBLISHED',
  PUBLISHED_WITH_CHANGES: 'PUBLISHED_WITH_CHANGES',
  DRAFT: 'DRAFT',
});
expect(ApiErrorCode.HOMEPAGE_DRAFT_NOT_FOUND).toBe(
  'HOMEPAGE_DRAFT_NOT_FOUND',
);
expect(ApiErrorCode.HOMEPAGE_DRAFT_NAME_CONFLICT).toBe(
  'HOMEPAGE_DRAFT_NAME_CONFLICT',
);
expect(ApiErrorCode.HOMEPAGE_PUBLISHED_DRAFT_DELETE_FORBIDDEN).toBe(
  'HOMEPAGE_PUBLISHED_DRAFT_DELETE_FORBIDDEN',
);
```

在 type test 中固定创建请求判别联合：

```ts
const copied: CreateHomepageDraftRequest = {
  name: '七夕活动',
  mode: 'COPY',
  sourceDraftId: '12',
};
const blank: CreateHomepageDraftRequest = {
  name: '空白方案',
  mode: 'BLANK',
};

// @ts-expect-error COPY 必须指定来源草稿
const missingSource: CreateHomepageDraftRequest = {
  name: '错误方案',
  mode: 'COPY',
};

// @ts-expect-error BLANK 不允许携带来源草稿
const blankWithSource: CreateHomepageDraftRequest = {
  name: '错误方案',
  mode: 'BLANK',
  sourceDraftId: '12',
};
```

- [ ] **步骤 2：运行测试确认契约尚不存在**

```bash
pnpm --filter @bake-mall/contracts test -- src/homepage.spec.ts
pnpm --filter @bake-mall/contracts typecheck
```

预期：因缺少新导出而失败。

- [ ] **步骤 3：实现精确契约**

在 `homepage.ts` 中新增：

```ts
export const HomepageDraftStatus = {
  PUBLISHED: 'PUBLISHED',
  PUBLISHED_WITH_CHANGES: 'PUBLISHED_WITH_CHANGES',
  DRAFT: 'DRAFT',
} as const;

export type HomepageDraftStatus =
  (typeof HomepageDraftStatus)[keyof typeof HomepageDraftStatus];

export type AdminHomepageDraftSummary = {
  id: string;
  name: string;
  status: HomepageDraftStatus;
  version: number;
  updatedByAdminId?: string;
  updatedAt: string;
  createdAt: string;
};

export type AdminHomepageDraftListView = PaginatedView<AdminHomepageDraftSummary> & {
  publishedDraftId?: string;
};

export type CreateHomepageDraftRequest =
  | { name: string; mode: 'COPY'; sourceDraftId: string }
  | { name: string; mode: 'BLANK' };

export type RenameHomepageDraftRequest = {
  name: string;
  version: number;
};
```

将 `AdminHomepageView` 调整为单套草稿详情：

```ts
export type AdminHomepageView = {
  id: string;
  pageKey: 'HOME';
  name: string;
  status: HomepageDraftStatus;
  draftConfig: HomepageDraftConfig;
  version: number;
  updatedByAdminId?: string;
  updatedAt: string;
  createdAt: string;
  publishedVersion?: number;
  publishedAt?: string;
  draftIssues: readonly HomepageValidationIssue[];
};
```

`SaveHomepageDraftRequest` 保持 `{ config, version }`，草稿 ID 只放路径参数；`PublishHomepageRequest` 保持 `{ version }`。在 `enums.ts` 增加三个明确错误码，避免将 404、名称冲突和禁止删除混成通用错误。

- [ ] **步骤 4：运行契约验证**

```bash
pnpm --filter @bake-mall/contracts test -- src/homepage.spec.ts
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/contracts build
```

预期：运行时测试、类型级断言和声明构建全部通过。

- [ ] **步骤 5：提交共享契约**

```bash
git add packages/shared-contracts/src
git commit -m "feat(contracts): define homepage draft management"
```

---

### 任务 3：新增多草稿 schema 并迁移旧数据

**文件：**
- 新建：`apps/api/src/database/migrations/0010-homepage-multiple-drafts.ts`
- 新建：`apps/api/src/database/migrations/0010-homepage-multiple-drafts.spec.ts`
- 新建：`apps/api/src/database/entities/homepage-draft.entity.ts`
- 新建：`apps/api/src/database/entities/homepage-draft.entity.spec.ts`
- 修改：`apps/api/src/database/entities/homepage-page.entity.ts`
- 修改：`apps/api/src/database/entities/index.ts`
- 修改：`apps/api/src/database/data-source.ts`
- 修改：`apps/api/src/database/database.module.ts`

- [ ] **步骤 1：写迁移失败测试**

测试 `up()` 的 SQL 和参数必须覆盖：

1. 创建 `homepage_drafts`，金额无关字段仍遵循 `BIGINT UNSIGNED`、UTC `DATETIME`、`utf8mb4_unicode_ci`；
2. 同一 `homepage_page_id` 下 `name` 唯一；
3. 复制旧 `draft_config/version/admin/time` 为“当前首页”；
4. 给 `homepage_pages` 增加 `published_draft_id`、`published_draft_version`；
5. 将旧发布行关联到迁入草稿；
6. 最后删除旧草稿字段，不能先删后拷贝；
7. `down()` 先恢复旧字段和数据，再删外键/新表。

迁移骨架：

```ts
export class HomepageMultipleDrafts1718000000009
  implements MigrationInterface {
  name = 'HomepageMultipleDrafts1718000000009';

  async up(queryRunner: QueryRunner): Promise<void> {
    // create table -> copy data -> attach published source -> drop old columns
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // restore columns -> copy selected draft back -> drop relation/table
  }
}
```

- [ ] **步骤 2：运行迁移测试确认失败**

```bash
pnpm --filter @bake-mall/api test -- \
  src/database/migrations/0010-homepage-multiple-drafts.spec.ts
```

预期：迁移文件尚不存在或 SQL 断言失败。

- [ ] **步骤 3：实现可逆迁移**

新表至少包含：

```sql
CREATE TABLE `homepage_drafts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `homepage_page_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `draft_config` JSON NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `updated_by_admin_id` BIGINT UNSIGNED NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX `uniq_homepage_drafts_page_name` (`homepage_page_id`, `name`),
  INDEX `idx_homepage_drafts_page_updated` (`homepage_page_id`, `updated_at`, `id`),
  CONSTRAINT `fk_homepage_drafts_page` FOREIGN KEY (`homepage_page_id`)
    REFERENCES `homepage_pages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_homepage_drafts_updated_admin` FOREIGN KEY (`updated_by_admin_id`)
    REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`homepage_pages` 最终保留 `published_config`、单调递增的 `published_version`、`published_draft_id`、`published_draft_version`、发布管理员/时间及创建更新时间；`published_draft_id` 使用 `ON DELETE RESTRICT`。迁移先插入“当前首页”草稿，再用其 ID 回填来源关系，最后移除 `draft_config/version/draft_updated_*`。

- [ ] **步骤 4：写并实现实体元数据测试**

断言：

```ts
expect(pageMetadata.uniques).toContainEqual(
  expect.objectContaining({ columns: ['pageKey'] }),
);
expect(draftMetadata.uniques).toContainEqual(
  expect.objectContaining({ columns: ['homepagePageId', 'name'] }),
);
```

`HomepagePage` 使用可空 `publishedDraftId/publishedDraftVersion`；`HomepageDraft` 保存独立 config/version，并通过关系关联 page 和最后编辑管理员。

- [ ] **步骤 5：注册实体和迁移并运行定向验证**

在 runtime 与 CLI 注册中都把 `0010` 放在 `0009` 后；运行：

```bash
pnpm --filter @bake-mall/api test -- \
  src/database/migrations/0010-homepage-multiple-drafts.spec.ts \
  src/database/entities/homepage-draft.entity.spec.ts
pnpm --filter @bake-mall/api typecheck
```

预期：测试和类型检查通过，runtime/CLI 顺序一致。

- [ ] **步骤 6：提交 schema 改造**

```bash
git add apps/api/src/database
git commit -m "feat(api): add homepage draft persistence"
```

---

### 任务 4：实现多草稿 CRUD 与指定草稿编辑

**文件：**
- 新建：`apps/api/src/homepage/dto/admin-homepage-draft-list-query.dto.ts`
- 新建：`apps/api/src/homepage/dto/create-homepage-draft.dto.ts`
- 新建：`apps/api/src/homepage/dto/rename-homepage-draft.dto.ts`
- 修改：`apps/api/src/homepage/dto/save-homepage-draft.dto.ts`
- 修改：`apps/api/src/homepage/admin-homepage.controller.ts`
- 修改：`apps/api/src/homepage/homepage.service.ts`
- 新建：`apps/api/test/homepage-drafts.e2e-spec.ts`

- [ ] **步骤 1：先写 CRUD e2e 失败用例**

覆盖以下请求：

```text
GET    /api/v1/admin/homepage/drafts?page=1&pageSize=20
POST   /api/v1/admin/homepage/drafts
GET    /api/v1/admin/homepage/drafts/:id
PUT    /api/v1/admin/homepage/drafts/:id
PATCH  /api/v1/admin/homepage/drafts/:id
DELETE /api/v1/admin/homepage/drafts/:id
```

关键断言：

```ts
expect(list.body.items.map(({ name }) => name)).toEqual([
  '七夕活动',
  '当前首页',
]);
expect(savedA.body.draftConfig).toEqual(updatedA);
expect(detailB.body.draftConfig).toEqual(originalB);
expect(staleSave.status).toBe(409);
expect(staleSave.body.code).toBe(ApiErrorCode.HOMEPAGE_VERSION_CONFLICT);
expect(duplicateName.status).toBe(409);
expect(missing.status).toBe(404);
```

同时覆盖 `COPY` 深拷贝来源配置、`BLANK` 使用标准空白配置、分页稳定排序、Admin guard、严格 DTO 白名单。

- [ ] **步骤 2：运行 e2e 确认旧单例路由失败**

```bash
pnpm --filter @bake-mall/api test:e2e -- homepage-drafts.e2e-spec.ts
```

预期：新路由返回 404 或契约不匹配。

- [ ] **步骤 3：实现 DTO 和 REST 控制器**

控制器改为：

```ts
@Controller('admin/homepage/drafts')
@UseGuards(JwtAdminGuard)
export class AdminHomepageController {
  @Get() list(@Query() query: AdminHomepageDraftListQueryDto) {}
  @Post() create(@Body() dto: CreateHomepageDraftDto, @CurrentAdmin() admin: AuthenticatedAdmin) {}
  @Get(':id') get(@Param('id') id: string) {}
  @Put(':id') save(@Param('id') id: string, @Body() dto: SaveHomepageDraftDto, @CurrentAdmin() admin: AuthenticatedAdmin) {}
  @Patch(':id') rename(@Param('id') id: string, @Body() dto: RenameHomepageDraftDto, @CurrentAdmin() admin: AuthenticatedAdmin) {}
  @Delete(':id') remove(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {}
  @Post(':id/publish') publish(@Param('id') id: string, @Body() dto: PublishHomepageDto, @CurrentAdmin() admin: AuthenticatedAdmin) {}
}
```

名称使用 `@IsString()`、`@Length(1, 120)` 并由服务 `trim()` 后持久化；分页 DTO 继承 `AdminPageQueryDto`。

- [ ] **步骤 4：实现列表、创建、详情、保存、重命名和删除**

服务保持纯校验函数，新增以下方法：

```ts
listAdminDrafts(query): Promise<AdminHomepageDraftListView>
createDraft(request, adminId): Promise<AdminHomepageView>
getAdminView(draftId): Promise<AdminHomepageView>
saveDraft(draftId, request, adminId): Promise<AdminHomepageView>
renameDraft(draftId, request, adminId): Promise<AdminHomepageView>
deleteDraft(draftId, adminId): Promise<void>
```

保存和重命名都必须使用条件更新：

```ts
const result = await repository.update(
  { id: draftId, homepagePageId: page.id, version: request.version },
  {
    draftConfig: structuredClone(request.config),
    version: request.version + 1,
    updatedByAdminId: adminId,
    updatedAt: new Date(),
  },
);
if (result.affected !== 1) {
  await throwMissingOrVersionConflict(repository, draftId, request.version);
}
```

创建、重命名把 MySQL 唯一索引异常映射为 `HOMEPAGE_DRAFT_NAME_CONFLICT`；删除前锁定聚合根，若 `publishedDraftId === draftId` 返回 409 `HOMEPAGE_PUBLISHED_DRAFT_DELETE_FORBIDDEN`。创建/保存/重命名/删除均在同一事务写摘要审计，不写整份 config。

- [ ] **步骤 5：运行 e2e、typecheck 和 lint**

```bash
pnpm --filter @bake-mall/api test:e2e -- homepage-drafts.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api lint
```

预期：CRUD、隔离、错误码和审计断言通过。

- [ ] **步骤 6：提交 CRUD**

```bash
git add apps/api/src/homepage apps/api/test/homepage-drafts.e2e-spec.ts
git commit -m "feat(api): manage homepage drafts"
```

---

### 任务 5：实现原子发布、Public 隔离与并发保证

**文件：**
- 修改：`apps/api/src/homepage/homepage.service.ts`
- 修改：`apps/api/test/homepage-drafts.e2e-spec.ts`
- 新建：`apps/api/test/homepage-drafts-concurrency-mysql.e2e-spec.ts`

- [ ] **步骤 1：先写发布与 Public 隔离失败测试**

按顺序验证：

1. 发布 A 后 Public 返回 A；
2. 修改并保存 A，Public 仍返回发布时快照，列表状态为 `PUBLISHED_WITH_CHANGES`；
3. 发布 B 后 Public 原子切换 B，A 变 `DRAFT`，B 变 `PUBLISHED`；
4. 发布失败返回 422 且原线上快照不变；
5. Public body 不含 `draftId/name/objectKey/adminId`；
6. 失效商品/分类链接仍降级为 `NONE`。

```ts
expect(publicAfterDraftSave.body).toEqual(publicBeforeDraftSave.body);
expect(list.body.items).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ id: draftA.id, status: 'PUBLISHED_WITH_CHANGES' }),
  ]),
);
```

- [ ] **步骤 2：写真实 MySQL 并发失败测试**

复用 `test/helpers/mysql-test-database.ts` 和现有并发屏障模式，覆盖：

```ts
const saves = await Promise.allSettled([
  saveDraft(id, version, configA),
  saveDraft(id, version, configB),
]);
expect(successCount(saves)).toBe(1);
expect(versionConflictCount(saves)).toBe(1);

await Promise.all([publish(draftA), publish(draftB)]);
const page = await pageRepository.findOneByOrFail({ pageKey: 'HOME' });
expect([draftA.id, draftB.id]).toContain(page.publishedDraftId);
expect(await countPublishedRoots()).toBe(1);
```

第二个测试还需验证 Public 配置、`publishedDraftId`、`publishedDraftVersion` 三者来自同一次发布，不能混合 A/B。

- [ ] **步骤 3：运行测试确认发布仍依赖旧单例字段**

```bash
pnpm --filter @bake-mall/api test:e2e -- homepage-drafts.e2e-spec.ts
pnpm --filter @bake-mall/api test:e2e -- homepage-drafts-concurrency-mysql.e2e-spec.ts
```

预期：指定草稿发布和并发测试失败。

- [ ] **步骤 4：实现事务发布**

在一个事务中：

```ts
const page = await pageRepository
  .createQueryBuilder('page')
  .where('page.pageKey = :pageKey', { pageKey: 'HOME' })
  .setLock('pessimistic_write')
  .getOneOrFail();

const draft = await draftRepository
  .createQueryBuilder('draft')
  .where('draft.id = :draftId', { draftId })
  .andWhere('draft.homepagePageId = :pageId', { pageId: page.id })
  .setLock('pessimistic_write')
  .getOne();
```

随后：

1. 校验草稿存在和 `request.version === draft.version`；
2. 执行现有结构、媒体 ownership、目标存在性和严格发布校验；
3. `nextPublishedVersion = (page.publishedVersion ?? 0) + 1`；
4. 原子写入 `publishedConfig = structuredClone(draft.draftConfig)`、`publishedDraftId = draft.id`、`publishedDraftVersion = draft.version`、发布管理员/时间；
5. 同一事务记录来源草稿、来源版本、发布版本、hash 和区块数量；
6. 返回目标草稿的新详情，但发布不增加草稿版本。

状态推导必须是纯函数：

```ts
function draftStatus(
  draft: HomepageDraft,
  page: HomepagePage,
): HomepageDraftStatus {
  if (page.publishedDraftId !== draft.id) return HomepageDraftStatus.DRAFT;
  return page.publishedDraftVersion === draft.version
    ? HomepageDraftStatus.PUBLISHED
    : HomepageDraftStatus.PUBLISHED_WITH_CHANGES;
}
```

Public 查询只读取 `homepage_pages.published_config`，不 join 当前草稿配置。

- [ ] **步骤 5：运行发布、并发和既有首页校验**

```bash
pnpm --filter @bake-mall/api test:e2e -- homepage-drafts.e2e-spec.ts
pnpm --filter @bake-mall/api test:e2e -- homepage-drafts-concurrency-mysql.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
```

预期：并发保存一成一败；并发发布可以串行完成，但最终聚合根、Public 快照和来源版本一致。

- [ ] **步骤 6：提交发布流程**

```bash
git add apps/api/src/homepage/homepage.service.ts apps/api/test
git commit -m "feat(api): publish homepage drafts atomically"
```

---

### 任务 6：实现 Admin 多草稿 API 与状态 hooks

**文件：**
- 修改：`apps/admin-web/src/views/homepage/api/index.ts`
- 新建：`apps/admin-web/src/views/homepage/hooks/useHomepageDrafts.ts`
- 新建：`apps/admin-web/src/views/homepage/hooks/useHomepageDrafts.spec.ts`
- 修改：`apps/admin-web/src/views/homepage/hooks/useHomepageEditor.ts`
- 新建：`apps/admin-web/src/views/homepage/hooks/useHomepageEditor.spec.ts`
- 修改：`apps/admin-web/src/views/homepage/mock/homepage.mock.ts`
- 修改：`apps/admin-web/src/views/homepage/type/form.ts`

- [ ] **步骤 1：写 API/hook 失败测试**

`useHomepageDrafts.spec.ts` 覆盖：

- 首次加载列表后优先选中 `PUBLISHED`/`PUBLISHED_WITH_CHANGES`，否则选第一条；
- 复制创建传当前草稿 ID，空白创建不传 ID；
- 创建后刷新列表并选中新草稿；
- 重命名更新版本和列表；
- 当前发布来源禁用删除；
- 删除普通草稿后选中相邻项；
- 旧列表请求不能覆盖新结果。

`useHomepageEditor.spec.ts` 覆盖：

```ts
await editor.load('12');
expect(homepageApi.getOne).toHaveBeenCalledWith('12');

editor.replaceDraft(changedConfig);
await editor.saveDraft();
expect(homepageApi.saveDraft).toHaveBeenCalledWith('12', {
  config: changedConfig,
  version: 3,
});

await editor.publish();
expect(homepageApi.publish).toHaveBeenCalledWith('12', { version: 4 });
```

并保留 409 时不覆盖本地配置、422 时保存问题列表。

- [ ] **步骤 2：运行测试确认单例 API 不满足要求**

```bash
pnpm --filter @bake-mall/admin-web test -- \
  src/views/homepage/hooks/useHomepageDrafts.spec.ts \
  src/views/homepage/hooks/useHomepageEditor.spec.ts
```

预期：新 hook/API 方法不存在而失败。

- [ ] **步骤 3：扩展 feature API**

`api/index.ts` 只组合全局 client：

```ts
export const homepageApi = {
  list: (query: AdminHomepageDraftListQuery) =>
    apiClient.get<AdminHomepageDraftListView>(buildListPath(query)),
  create: (body: CreateHomepageDraftRequest) =>
    apiClient.post<AdminHomepageView>('/admin/homepage/drafts', body),
  getOne: (id: string) =>
    apiClient.get<AdminHomepageView>(`/admin/homepage/drafts/${id}`),
  saveDraft: (id: string, body: SaveHomepageDraftRequest) =>
    apiClient.put<AdminHomepageView>(`/admin/homepage/drafts/${id}`, body),
  rename: (id: string, body: RenameHomepageDraftRequest) =>
    apiClient.patch<AdminHomepageView>(`/admin/homepage/drafts/${id}`, body),
  remove: (id: string) =>
    apiClient.delete<void>(`/admin/homepage/drafts/${id}`),
  publish: (id: string, body: PublishHomepageRequest) =>
    apiClient.post<AdminHomepageView>(
      `/admin/homepage/drafts/${id}/publish`,
      body,
    ),
};
```

不要在 API 层重塑 DTO 或处理状态码。

- [ ] **步骤 4：实现两个 hooks**

`useHomepageDrafts` 管理列表、选中 ID、分页和 CRUD；`useHomepageEditor` 改为显式 `load(draftId)`，并把当前 ID 保存在 hook 状态中。切换 ID 前由 view 解决 dirty 决策，hook 不弹 UI 对话框。

所有列表更新使用 `map/filter/spread`，不原地修改 props 或响应数组；异步列表使用 request sequence 忽略过期响应。

- [ ] **步骤 5：运行 hook 测试和静态检查**

```bash
pnpm --filter @bake-mall/admin-web test -- \
  src/views/homepage/hooks/useHomepageDrafts.spec.ts \
  src/views/homepage/hooks/useHomepageEditor.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
```

预期：全部通过。

- [ ] **步骤 6：提交 Admin 数据层**

```bash
git add apps/admin-web/src/views/homepage/api \
  apps/admin-web/src/views/homepage/hooks \
  apps/admin-web/src/views/homepage/mock \
  apps/admin-web/src/views/homepage/type
git commit -m "feat(admin): add homepage draft state management"
```

---

### 任务 7：完成三栏多草稿装修工作区

**文件：**
- 新建：`apps/admin-web/src/views/homepage/components/HomepageDraftSidebar.vue`
- 新建：`apps/admin-web/src/views/homepage/components/HomepageDraftCreateDialog.vue`
- 修改：`apps/admin-web/src/views/homepage/HomepageEditorView.vue`
- 修改：`apps/admin-web/src/views/homepage/HomepageEditorView.spec.ts`
- 修改：`apps/admin-web/src/views/homepage/components/HomepagePublishBar.vue`
- 修改：`apps/admin-web/src/views/homepage/components/HomepageEditorForm.vue`（仅在选中项切换需要 reset 时）
- 修改：`apps/admin-web/src/views/homepage/config/defaults.ts`

- [ ] **步骤 1：写视图失败测试**

测试至少覆盖：

```ts
expect(wrapper.get('[data-homepage-draft-sidebar]').exists()).toBe(true);
expect(wrapper.get('[data-editor-scroll]').exists()).toBe(true);
expect(wrapper.get('[data-preview-device]').exists()).toBe(true);
```

交互覆盖：

1. 点击另一草稿且当前 clean：直接加载目标；
2. dirty 时出现三个选择；
3. “保存并切换”先等待保存成功再加载目标，保存失败不切换；
4. “放弃修改并切换”不保存；
5. “取消”保持当前草稿；
6. 当前线上来源草稿删除按钮禁用并说明原因；
7. 新建复制/空白请求正确；
8. 发布后侧栏状态立即刷新；
9. `PUBLISHED_WITH_CHANGES` 显示“线上来源 · 有未发布修改”。

- [ ] **步骤 2：运行视图测试确认没有草稿侧栏**

```bash
pnpm --filter @bake-mall/admin-web test -- \
  src/views/homepage/HomepageEditorView.spec.ts
```

预期：草稿侧栏和切换行为断言失败。

- [ ] **步骤 3：实现纯展示侧栏和创建弹窗**

`HomepageDraftSidebar.vue` 只接收 props 并 emit：

```ts
defineProps<{
  items: readonly AdminHomepageDraftSummary[];
  activeId: string | null;
  loading: boolean;
}>();

defineEmits<{
  select: [id: string];
  create: [];
  rename: [draft: AdminHomepageDraftSummary];
  remove: [draft: AdminHomepageDraftSummary];
}>();
```

每项展示名称、最后更新时间和状态；禁止删除状态不是 `DRAFT` 的来源草稿。弹窗表单包含 `name` 和 `mode: 'COPY' | 'BLANK'`，只有 COPY 时使用当前草稿 ID。

- [ ] **步骤 4：把 `HomepageEditorView` 改成三栏编排**

桌面布局：

```css
.homepage-editor-view__layout {
  display: grid;
  grid-template-columns:
    minmax(210px, 0.48fr)
    minmax(500px, 1.35fr)
    minmax(320px, 0.78fr);
  gap: 18px;
}
```

左侧和中间各自滚动，右侧保持手机预览；发布条仍固定在工作区底部。`HomepageEditorForm` 和 `HomepagePhonePreview` 只消费当前 `editor.draft.value`，不感知列表。

实现切换编排：

```ts
async function selectDraft(nextId: string): Promise<void> {
  if (nextId === drafts.activeId.value) return;
  if (!editor.dirty.value) return loadDraft(nextId);

  const decision = await askDirtySwitchDecision();
  if (decision === 'cancel') return;
  if (decision === 'save') await editor.saveDraft();
  await loadDraft(nextId);
}
```

Element Plus 默认 confirm 只有两个按钮，因此三选一必须使用受控对话框或先弹 `ElMessageBox` 的“保存并切换 / 放弃修改”，取消关闭；不能把关闭误判为放弃。

- [ ] **步骤 5：补齐状态和发布刷新**

`HomepagePublishBar` 显示当前草稿名称、草稿版本和状态。发布成功后：

1. 用返回详情更新 editor；
2. 重新加载侧栏；
3. 保持当前草稿选中；
4. H5 仍由 Public API 读取发布快照。

删除成功后选择删除项后面的草稿；没有后项则选前项。若列表意外为空，显示空状态并只允许创建空白草稿。

- [ ] **步骤 6：验证 Admin 视图和既有编辑组件**

```bash
pnpm --filter @bake-mall/admin-web test -- \
  src/views/homepage/HomepageEditorView.spec.ts \
  src/views/homepage/components/HomepageEditorForm.spec.ts \
  src/views/homepage/components/HomepagePhonePreview.spec.ts \
  src/views/homepage/hooks/useHomepageDrafts.spec.ts \
  src/views/homepage/hooks/useHomepageEditor.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/admin-web build
```

预期：测试、类型、lint、构建全部通过；四类区块编辑能力未回归。

- [ ] **步骤 7：提交 Admin 工作区**

```bash
git add apps/admin-web/src/views/homepage
git commit -m "feat(admin): add homepage draft workspace"
```

---

### 任务 8：迁移与真实浏览器验收

**文件：**
- 验证整个改动，不新增业务代码；若验收发现缺陷，回到对应任务先补失败测试再修复。

- [ ] **步骤 1：运行格式、差异和相关包全量验证**

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/contracts build
pnpm --filter @bake-mall/api test
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api lint
pnpm --filter @bake-mall/admin-web test
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/admin-web build
pnpm --filter @bake-mall/h5-store test
pnpm --filter @bake-mall/h5-store typecheck
pnpm --filter @bake-mall/h5-store lint
pnpm --filter @bake-mall/h5-store build
pnpm format:check
git diff --check
```

预期：所有命令退出码为 0。若仓库已有与本次无关的失败，必须记录准确命令和输出，不得声称全量通过。

- [ ] **步骤 2：在真实 MySQL 上验证迁移可重复运行**

```bash
pnpm services:up
pnpm --filter @bake-mall/api migration:run
pnpm --filter @bake-mall/api migration:run
```

第一次预期执行 `0010`；第二次预期无待执行迁移。检查：

- 原唯一草稿配置被迁入“当前首页”；
- 原已发布 H5 配置不变；
- `published_draft_id` 和 `published_draft_version` 正确；
- 新增第二套同名草稿被唯一约束拒绝。

- [ ] **步骤 3：启动真实应用并验收草稿工作区**

运行 `pnpm dev`，使用本地 Admin 凭据进入 `/homepage`：

1. 页面同时显示草稿列表、当前编辑器和手机预览；
2. 从当前草稿复制一套“活动版”，再创建一套空白草稿；
3. 重命名后列表立即更新；
4. 编辑 A、切换 B，分别验证保存并切换、放弃并切换、取消；
5. 发布 A，确认 A 为线上版本且不可删除；
6. 保存 A 的未发布修改，确认状态变为“线上来源 · 有未发布修改”；
7. 发布 B，确认 B 成为线上版本，A 变普通草稿并可删除；
8. 双标签编辑同一草稿，旧版本保存返回冲突且本地内容不被自动覆盖。

- [ ] **步骤 4：验收 H5 内容边界和发布隔离**

在 390×844 与 320px 宽度验证：

1. `/` 只显示发布的四类装修区块，不出现固定 Banner、分类、商品卡或“下一炉”；
2. `/products` 仍显示原 Banner、分类和商品；
3. 修改并仅保存当前来源草稿，H5 仍显示旧快照；
4. 再发布后 H5 原子切换新快照；
5. 未发布、请求失败和重试状态正确；
6. 浏览器 console 无 Vue warning/error；
7. Public 响应不含草稿或管理字段。

保存最终 Admin 和 H5 验收截图到临时目录，不把运行时截图、MinIO 数据或数据库归档纳入提交。

- [ ] **步骤 5：检查最终工作区并提交验收阶段修复（如有）**

```bash
git status --short
git diff --stat
git diff --check
```

只提交源码、测试、迁移和计划；保留已有未跟踪归档文件，不执行 `git clean`、`reset --hard` 或覆盖用户文件。

---

## 自检结果

### 规格覆盖

- H5 固定商城模块移除：任务 1、8。
- 多草稿创建、列表、切换、重命名、删除：任务 2、4、6、7。
- 保存/发布隔离、当前来源不可删除：任务 4、5、7、8。
- 线上不可变快照和 Public 隐私边界：任务 5、8。
- 旧数据兼容迁移与二次运行：任务 3、8。
- 乐观锁、并发发布、事务审计：任务 4、5。
- 三栏后台工作区与 dirty 切换决策：任务 7。

### 类型一致性

- 草稿 ID 始终放 URL，不在 save/publish body 重复；
- `publishedVersion` 是聚合根单调递增的发布序号；
- `publishedDraftVersion` 是生成当前线上快照时的来源草稿版本；
- 状态只由 `publishedDraftId`、`publishedDraftVersion` 和草稿当前 `version` 推导；
- Public DTO 保持现有外形，不泄漏来源信息。

### 明确不做

- 不做草稿历史版本、回滚、归档、定时发布；
- 不让 H5 选择草稿或读取未发布配置；
- 不把草稿列表拆成独立跳转式页面；
- 不修改 `0009` 历史迁移；
- 不删除 `/products` 的正式商城实现；
- 不提交临时素材、截图、数据库或 MinIO 归档。
