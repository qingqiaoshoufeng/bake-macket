# H5 与 Admin 全局视觉焕新实施计划

> **供智能代理执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐任务实施本计划。步骤使用复选框（`- [ ]`）跟踪；子代理不得创建顶层待办。

**目标：** 在不改变业务逻辑、API、DTO 与状态机的前提下，将 H5 全面升级为清透统一的“晨露烘焙”，将 Admin 全面升级为高效且有品牌感的“店长小助手”轻二次元后台。

**架构：** 两端分别先建立全局 token 与无业务逻辑的布局组件，再按“核心壳层 → 核心流程 → 辅助页面”迁移。现有 hooks、stores、feature api、共享契约和路由行为保持不变；页面只替换结构、class、插槽组合和 scoped 样式。最终通过定向测试、包级检查和真实浏览器多视口验收汇合。

**技术栈：** Vue 3.5、Vite 5、TypeScript 5.8、Vant 4.9、Element Plus 2.9、Pinia、Vue Router、Vitest、Chrome CDP。

## 全局约束

- 权威规格：`docs/superpowers/specs/2026-07-19-storefront-admin-visual-refresh-design.md`。
- 最高原则：视觉优化必须保证流程通畅；不得牺牲触控可用性、表格效率、表单反馈、错误状态、加载状态或禁用状态。
- 不修改 API、数据库、`@bake-mall/contracts`、订单状态机、库存、鉴权和持久化逻辑。
- H5 主要支持 360–560px；Admin 主要支持 1024–1920px。
- H5 触控目标至少 44×44px；固定导航和操作条必须使用安全区并预留内容底部空间。
- Admin 二次元装饰只进入壳层、页面头、Dashboard 和空状态；不侵入高密度表格单元格与复杂表单。
- 任何 `apps/h5-store` / `apps/admin-web` 改动继续遵守 `frontend-page-generator` 与 `js-functional-style`：展示组件无请求、业务保留在 hooks/stores、不可变更新、配置集中。
- 不引入新 UI 框架、第三方富文本编辑器、运行时主题切换或装饰动画库。
- 视觉任务不机械执行 CSS red-green；新增结构组件和关键 DOM 契约必须先写结构测试并观察 RED。
- 实施过程中不提交；每个任务以定向验证和 `git diff --check` 作为检查点。保留现有 `.claude/skills/verify/SKILL.md`，不得覆盖。

## 文件职责地图

### H5 基础

- `apps/h5-store/src/styles/theme.css`：全局 token、reset、Vant 变量覆盖、页面/控件 utility。
- `apps/h5-store/src/components/layout/StorePage.vue`：560px 画布、gutter、底部安全区。
- `apps/h5-store/src/components/layout/StorePageHeader.vue`：返回、eyebrow、标题、说明和右侧动作。
- `apps/h5-store/src/components/layout/StoreSection.vue`：统一区块标题与 slot。
- `apps/h5-store/src/components/feedback/StoreStatePanel.vue`：loading/error/empty 三种展示。
- `apps/h5-store/src/components/layout/StoreLayout.spec.ts`：锁定布局结构、slot 与安全区 class。

### H5 领域页面

- `HomeView.vue`、`CategoryView.vue`、`ProductDetailView.vue`：商品发现主链。
- `ProductCard.vue`、`StoreTabbar.vue`、`SkuPicker.vue`：商品卡、导航、规格选择。
- `CartView.vue`、`CheckoutView.vue`：购物车与结算。
- `OrdersView.vue`、`OrderDetailView.vue`：订单列表与快照详情。
- `LoginView.vue`、`ProfileView.vue`、`AddressesView.vue`、`AddressForm.vue`：身份与用户辅助页面。
- `NotFoundView.vue`、`PlaceholderView.vue`：统一异常/占位状态。

### Admin 基础

- `apps/admin-web/src/styles/theme.css`：Admin token、reset、Element Plus 全局覆盖。
- `apps/admin-web/src/config/navigation.ts`：侧栏分组、路径、标签和图标名纯配置。
- `apps/admin-web/src/layouts/AdminLayout.vue`：侧栏、sticky topbar、内容画布与窄屏提示。
- `apps/admin-web/src/components/layout/AdminPage.vue`：页面垂直节奏。
- `apps/admin-web/src/components/layout/AdminPageHeader.vue`：统一页面头和主操作 slot。
- `apps/admin-web/src/components/layout/AdminDataPanel.vue`：工具区、数据区、分页区。
- `apps/admin-web/src/components/feedback/AdminEmptyState.vue`：统一轻插画空状态。
- `apps/admin-web/src/components/layout/AdminVisualShell.spec.ts`：结构与 slot 契约。

### Admin 领域页面

- `DashboardView.vue`、`LoginView.vue`：品牌入口。
- `CategoriesView.vue`、`ProductsView.vue`、`BannersView.vue`、`OrdersView.vue`：列表页组合。
- 各领域 `components/*Table.vue`、`OrderFilters.vue`：统一表格/筛选密度。
- `ProductEditorView.vue`、`ProductForm.vue`、`SkuTableEditor.vue`、`ProductImagesEditor.vue`：商品编辑任务流。
- `BannerFormDialog.vue`、`OrderDetailDrawer.vue`、`CreateCategoryDialog.vue`：弹窗/抽屉。
- `CosImageUploader.vue`、`RichTextEditor.vue`：共享编辑组件。
- `NotFoundView.vue`、`PlaceholderView.vue`：统一异常/占位状态。

---

### 任务 1：建立 H5“晨露烘焙”视觉基础与布局组件

**文件：**

- 修改：`apps/h5-store/src/styles/theme.css`
- 新建：`apps/h5-store/src/components/layout/StorePage.vue`
- 新建：`apps/h5-store/src/components/layout/StorePageHeader.vue`
- 新建：`apps/h5-store/src/components/layout/StoreSection.vue`
- 新建：`apps/h5-store/src/components/feedback/StoreStatePanel.vue`
- 新建：`apps/h5-store/src/components/layout/StoreLayout.spec.ts`

**接口：**

- 产出：`StorePage` props `{ withTabbar?: boolean; withFixedAction?: boolean; compact?: boolean }`。
- 产出：`StorePageHeader` props `{ title: string; eyebrow?: string; description?: string; back?: boolean }`，emit `back`，slots `default/actions`。
- 产出：`StoreSection` props `{ title: string; eyebrow?: string; description?: string }`，slots `default/actions`。
- 产出：`StoreStatePanel` props `{ state: 'loading' | 'empty' | 'error'; title: string; description?: string }`，slot `action`。

- [ ] **步骤 1：写布局组件 RED 测试**

新建 `StoreLayout.spec.ts`，测试必须包含：

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import StorePage from './StorePage.vue';
import StorePageHeader from './StorePageHeader.vue';
import StoreSection from './StoreSection.vue';
import StoreStatePanel from '../feedback/StoreStatePanel.vue';

describe('H5 visual shell', () => {
  it('exposes safe page spacing classes for tabbar and fixed actions', () => {
    const wrapper = mount(StorePage, {
      props: { withTabbar: true, withFixedAction: true },
      slots: { default: '<p>content</p>' },
    });
    expect(wrapper.classes()).toContain('store-page--with-tabbar');
    expect(wrapper.classes()).toContain('store-page--with-fixed-action');
    expect(wrapper.text()).toContain('content');
  });

  it('renders consistent page and section hierarchy', () => {
    const header = mount(StorePageHeader, {
      props: {
        eyebrow: 'FRESH TODAY',
        title: '今日烘焙',
        description: '门店现做',
      },
    });
    expect(header.get('h1').text()).toBe('今日烘焙');
    expect(header.text()).toContain('FRESH TODAY');

    const section = mount(StoreSection, {
      props: { eyebrow: 'POPULAR', title: '人气烘焙' },
      slots: { default: '<div>products</div>' },
    });
    expect(section.get('h2').text()).toBe('人气烘焙');
    expect(section.text()).toContain('products');
  });

  it('keeps feedback states explicit in text', () => {
    const wrapper = mount(StoreStatePanel, {
      props: { state: 'error', title: '加载失败', description: '请稍后重试' },
    });
    expect(wrapper.attributes('data-state')).toBe('error');
    expect(wrapper.text()).toContain('加载失败');
    expect(wrapper.text()).toContain('请稍后重试');
  });
});
```

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/h5-store test -- src/components/layout/StoreLayout.spec.ts
```

预期：FAIL，四个组件尚不存在。

- [ ] **步骤 3：实现 token 与组件**

`theme.css` 至少定义以下稳定 token：

```css
:root {
  --mall-canvas: #f7faf6;
  --mall-surface: #ffffff;
  --mall-surface-soft: #eef5ec;
  --mall-primary: #78a281;
  --mall-primary-strong: #4f7659;
  --mall-accent: #e9a86f;
  --mall-text: #2f3b33;
  --mall-text-muted: #748078;
  --mall-border: #dfe8de;
  --mall-danger: #c75d62;
  --mall-warning: #d39453;
  --mall-success: #5d936d;
  --mall-space-1: 4px;
  --mall-space-2: 8px;
  --mall-space-3: 12px;
  --mall-space-4: 16px;
  --mall-space-5: 20px;
  --mall-space-6: 24px;
  --mall-space-8: 32px;
  --mall-radius-control: 10px;
  --mall-radius-card: 16px;
  --mall-radius-feature: 22px;
  --mall-shadow-card: 0 8px 24px rgb(58 83 64 / 7%);
  --mall-shadow-floating: 0 14px 34px rgb(48 72 54 / 14%);
  --mall-page-width: 560px;
  --mall-page-gutter: 16px;
  --mall-tabbar-height: 70px;
}
```

`StorePage.vue` 根节点 class 固定为 `store-page`，通过 class modifier 提供安全区；`StorePageHeader` 和 `StoreSection` 只使用 props/slots，不导入 router/store；`StoreStatePanel` 以文字和 `data-state` 同时表达状态。

- [ ] **步骤 4：运行 GREEN 与包级检查**

```bash
pnpm --filter @bake-mall/h5-store test -- src/components/layout/StoreLayout.spec.ts
pnpm --filter @bake-mall/h5-store typecheck
pnpm --filter @bake-mall/h5-store lint
```

预期：测试 PASS，typecheck/lint 退出码 0。

- [ ] **步骤 5：检查任务 diff，不提交**

```bash
git diff --check -- apps/h5-store/src/styles/theme.css apps/h5-store/src/components/layout apps/h5-store/src/components/feedback
```

预期：无输出；组件中不命中 `fetch|Api|Store|useRouter`。

---

### 任务 2：迁移 H5 商品发现与导航主链

**文件：**

- 修改：`apps/h5-store/src/views/HomeView.vue`
- 修改：`apps/h5-store/src/views/CategoryView.vue`
- 修改：`apps/h5-store/src/views/ProductDetailView.vue`
- 修改：`apps/h5-store/src/views/catalog/components/ProductCard.vue`
- 修改：`apps/h5-store/src/views/catalog/components/StoreTabbar.vue`
- 修改：`apps/h5-store/src/components/SkuPicker.vue`
- 修改：`apps/h5-store/src/views/HomeView.spec.ts`
- 修改：`apps/h5-store/src/views/ProductDetailView.spec.ts`
- 修改：`apps/h5-store/src/views/catalog/components/ProductCard.spec.ts`
- 修改：`apps/h5-store/src/components/SkuPicker.spec.ts`

**接口：**

- 消费：任务 1 的 `StorePage`、`StorePageHeader`、`StoreSection`、`StoreStatePanel`。
- 保留：`ProductCard` emit `open(id)`、`SkuPicker` emit `add({ skuId, quantity })`、`StoreTabbar` 路由行为。

- [ ] **步骤 1：扩展结构测试并观察 RED**

在现有测试中增加：

```ts
expect(wrapper.find('.store-page').exists()).toBe(true);
expect(wrapper.find('.store-section').exists()).toBe(true);
expect(
  wrapper.get('[data-testid="store-tabbar"]').attributes('aria-label'),
).toBe('商城主导航');
```

`ProductCard.spec.ts` 增加：

```ts
expect(
  wrapper.get('[data-testid="product-card-product-1"]').classes(),
).toContain('product-card');
expect(wrapper.get('.product-card__body').attributes('data-layout')).toBe(
  'stable',
);
```

`SkuPicker.spec.ts` 增加：

```ts
expect(wrapper.get('[data-testid="qty"]').classes()).toContain(
  'sku-picker__qty-input',
);
expect(
  wrapper.get('[data-testid="add-cart"]').attributes('aria-disabled'),
).toBe('true');
```

运行：

```bash
pnpm --filter @bake-mall/h5-store test -- src/views/HomeView.spec.ts src/views/ProductDetailView.spec.ts src/views/catalog/components/ProductCard.spec.ts src/components/SkuPicker.spec.ts
```

预期：新增结构断言 FAIL；既有业务断言继续执行。

- [ ] **步骤 2：迁移首页与分类页**

- `HomeView` 使用 `StorePage with-tabbar` 和三个 `StoreSection`；Banner 固定比例并增加底部渐变文字层；hero 体量缩小。
- `CategoryView` 使用 `StorePageHeader`，搜索框/结果说明放入统一工具卡；保留 `q`、category id 和现有加载方法。
- 商品网格固定两列，360px 下 gap 不小于 10px；禁止横向溢出。

- [ ] **步骤 3：迁移商品卡、详情、SKU 与底栏**

- `ProductCard` 图片比例统一为 `1 / 0.78`，body 使用 `data-layout="stable"`；标题最多两行，简介最多两行，价格区固定在底部。
- `ProductDetailView` 使用连续内容画布、统一返回按钮、摘要卡和富文本区；不改变 `v-html` 数据源。
- `SkuPicker` 为 quantity input 增加 `sku-picker__qty-input`，提交按钮同步 `:aria-disabled="!canAdd"`；保留禁用判断。
- `StoreTabbar` 增加 `data-testid="store-tabbar"`，改为浮层胶囊；active 同时有文字色、浅背景和顶部微标识。

- [ ] **步骤 4：运行 GREEN 与包级检查**

```bash
pnpm --filter @bake-mall/h5-store test -- src/views/HomeView.spec.ts src/views/ProductDetailView.spec.ts src/views/catalog/components/ProductCard.spec.ts src/components/SkuPicker.spec.ts src/views/catalog/hooks/useCatalog.spec.ts
pnpm --filter @bake-mall/h5-store typecheck
pnpm --filter @bake-mall/h5-store lint
```

预期：全部 PASS；现有 Banner 跳转、最低可售价格和 SKU 禁用逻辑不变。

- [ ] **步骤 5：检查任务 diff，不提交**

```bash
git diff --check -- apps/h5-store/src/views/HomeView.vue apps/h5-store/src/views/CategoryView.vue apps/h5-store/src/views/ProductDetailView.vue apps/h5-store/src/views/catalog/components apps/h5-store/src/components/SkuPicker.vue
```

---

### 任务 3：迁移 H5 交易、订单与用户辅助页面

**文件：**

- 修改：`apps/h5-store/src/views/CartView.vue`
- 修改：`apps/h5-store/src/views/CheckoutView.vue`
- 修改：`apps/h5-store/src/views/OrdersView.vue`
- 修改：`apps/h5-store/src/views/OrderDetailView.vue`
- 修改：`apps/h5-store/src/views/LoginView.vue`
- 修改：`apps/h5-store/src/views/ProfileView.vue`
- 修改：`apps/h5-store/src/views/AddressesView.vue`
- 修改：`apps/h5-store/src/components/AddressForm.vue`
- 修改：`apps/h5-store/src/views/NotFoundView.vue`
- 修改：`apps/h5-store/src/views/PlaceholderView.vue`
- 修改：`apps/h5-store/src/views/CartView.spec.ts`
- 修改：`apps/h5-store/src/views/CheckoutView.spec.ts`
- 修改：`apps/h5-store/src/views/LoginView.spec.ts`

**接口：**

- 消费：任务 1 的布局/状态组件，任务 2 的 `StoreTabbar`。
- 保留：所有 data-testid、submit handler、Pinia store 调用、路由目标与错误文案。

- [ ] **步骤 1：锁定流程 DOM 契约并观察 RED**

在现有测试增加：

```ts
expect(wrapper.find('.store-page--with-fixed-action').exists()).toBe(true);
expect(wrapper.get('[data-testid="checkout"]').classes()).toContain(
  'store-primary-action',
);
```

结算测试增加：

```ts
expect(wrapper.findAll('.store-form-card').length).toBeGreaterThanOrEqual(3);
expect(
  wrapper.get('[data-testid="submit"]').attributes('aria-disabled'),
).toBeDefined();
```

登录测试增加：

```ts
expect(wrapper.get('main').classes()).toContain('store-auth-page');
```

运行：

```bash
pnpm --filter @bake-mall/h5-store test -- src/views/CartView.spec.ts src/views/CheckoutView.spec.ts src/views/LoginView.spec.ts
```

预期：新增视觉结构断言 FAIL，既有流程断言不变。

- [ ] **步骤 2：迁移购物车与结算**

- `CartView` 使用 `StorePage with-tabbar with-fixed-action`；购物车行改为图片/信息/动作稳定网格。
- Vant `Stepper` 使用统一变量和容器，不允许浏览器原生 number 长输入框破坏布局。
- 固定结算条 class 为 `store-fixed-action`，主按钮 class 为 `store-primary-action`，与 Tabbar 垂直错开。
- `CheckoutView` 拆成 `store-form-card`：商品清单、履约方式、联系人、履约详情、备注；submit 增加 `:aria-disabled="!canSubmit"`，不改 canSubmit。

- [ ] **步骤 3：迁移订单、地址、个人与登录**

- `OrdersView`、`OrderDetailView` 统一状态胶囊、金额和快照卡；保留状态文字。
- `AddressesView` 与 `AddressForm` 使用同一表单卡/按钮样式；默认地址仍有文字标签。
- `ProfileView` 使用账户卡与功能入口，不新增虚假数据。
- `LoginView` 使用 `store-auth-page`，保留开发登录和小程序消息区域，开发提示降为次级面板。
- `NotFoundView`、`PlaceholderView` 使用 `StoreStatePanel`。

- [ ] **步骤 4：运行 H5 完整检查**

```bash
pnpm --filter @bake-mall/h5-store test
pnpm --filter @bake-mall/h5-store typecheck
pnpm --filter @bake-mall/h5-store lint
pnpm --filter @bake-mall/h5-store build
```

预期：测试、typecheck、lint、build 全部退出码 0。

- [ ] **步骤 5：H5 静态扫描和 diff 检查**

```bash
git diff --check -- apps/h5-store
rg -n 'width:\s*[6-9][0-9]{2}px|margin-left:\s*[0-9]{3}px|position:\s*fixed' apps/h5-store/src --glob '*.vue'
```

预期：无大于画布的硬编码宽度；所有 fixed 命中均属于返回按钮、Tabbar 或正式 fixed action，并有安全区/底部预留。

---

### 任务 4：建立 Admin“店长小助手”视觉基础与应用壳

**文件：**

- 修改：`apps/admin-web/src/styles/theme.css`
- 新建：`apps/admin-web/src/config/navigation.ts`
- 修改：`apps/admin-web/src/layouts/AdminLayout.vue`
- 修改：`apps/admin-web/src/layouts/AdminLayout.spec.ts`
- 新建：`apps/admin-web/src/components/layout/AdminPage.vue`
- 新建：`apps/admin-web/src/components/layout/AdminPageHeader.vue`
- 新建：`apps/admin-web/src/components/layout/AdminDataPanel.vue`
- 新建：`apps/admin-web/src/components/feedback/AdminEmptyState.vue`
- 新建：`apps/admin-web/src/components/layout/AdminVisualShell.spec.ts`

**接口：**

- 产出：`ADMIN_NAV_GROUPS: readonly { label: string; items: readonly { path: string; label: string; icon: string }[] }[]`。
- 产出：`AdminPage` slots `default`。
- 产出：`AdminPageHeader` props `{ title: string; eyebrow?: string; description?: string }`，slot `actions`。
- 产出：`AdminDataPanel` slots `toolbar/default/footer`。
- 产出：`AdminEmptyState` props `{ title: string; description?: string; tone?: 'lilac' | 'pink' | 'mint' }`，slot `action`。

- [ ] **步骤 1：写 Admin 壳层 RED 测试**

```ts
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AdminPageHeader from './AdminPageHeader.vue';
import AdminDataPanel from './AdminDataPanel.vue';
import AdminEmptyState from '../feedback/AdminEmptyState.vue';

it('provides a consistent page hierarchy and action slot', () => {
  const wrapper = mount(AdminPageHeader, {
    props: { eyebrow: 'CATALOG', title: '商品管理', description: '维护商品' },
    slots: { actions: '<button>新增商品</button>' },
  });
  expect(wrapper.get('h1').text()).toBe('商品管理');
  expect(wrapper.text()).toContain('新增商品');
});

it('separates toolbar, data and footer regions', () => {
  const wrapper = mount(AdminDataPanel, {
    slots: {
      toolbar: '<div>filters</div>',
      default: '<div>table</div>',
      footer: '<div>pager</div>',
    },
  });
  expect(wrapper.find('[data-region="toolbar"]').exists()).toBe(true);
  expect(wrapper.find('[data-region="data"]').exists()).toBe(true);
  expect(wrapper.find('[data-region="footer"]').exists()).toBe(true);
});

it('renders explicit empty state copy', () => {
  const wrapper = mount(AdminEmptyState, {
    props: { title: '暂无商品', description: '先创建第一件商品' },
  });
  expect(wrapper.text()).toContain('暂无商品');
});
```

同时扩展 `AdminLayout.spec.ts`：断言侧栏导航有 `data-testid="admin-nav"`、当前菜单有 `aria-current="page"`、内容区有 `admin-layout__canvas`。

- [ ] **步骤 2：运行 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/components/layout/AdminVisualShell.spec.ts src/layouts/AdminLayout.spec.ts
```

预期：新增组件/结构不存在。

- [ ] **步骤 3：实现 token、导航配置与壳层**

`theme.css` 至少定义：

```css
:root {
  --admin-canvas: #f7f6fb;
  --admin-surface: #ffffff;
  --admin-surface-soft: #f3effa;
  --admin-sidebar: #fbfaff;
  --admin-primary: #7965b8;
  --admin-primary-soft: #eee9fb;
  --admin-pink: #e98bac;
  --admin-mint: #78aa95;
  --admin-yellow: #e9bd6e;
  --admin-text: #322f3d;
  --admin-muted: #777184;
  --admin-border: #e7e2ef;
  --admin-radius-control: 10px;
  --admin-radius-card: 16px;
  --admin-radius-feature: 20px;
  --admin-shadow-card: 0 10px 30px rgb(73 57 105 / 7%);
  --admin-sidebar-width: 248px;
  --admin-topbar-height: 68px;
  --admin-content-max: 1600px;
}
```

`navigation.ts` 使用 Element Plus 已安装的图标名或本地纯文本 icon key，不新增依赖。`AdminLayout` 从配置渲染分组导航、线性图标容器、sticky topbar 和 canvas；保留 pageTitle、auth、logout 与 route active 逻辑。

- [ ] **步骤 4：运行 GREEN 与包级检查**

```bash
pnpm --filter @bake-mall/admin-web test -- src/components/layout/AdminVisualShell.spec.ts src/layouts/AdminLayout.spec.ts src/router/index.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
```

- [ ] **步骤 5：检查任务 diff，不提交**

```bash
git diff --check -- apps/admin-web/src/styles/theme.css apps/admin-web/src/config/navigation.ts apps/admin-web/src/layouts apps/admin-web/src/components/layout apps/admin-web/src/components/feedback
```

---

### 任务 5：迁移 Admin 品牌入口、Dashboard 与状态页面

**文件：**

- 修改：`apps/admin-web/src/views/LoginView.vue`
- 修改：`apps/admin-web/src/views/LoginView.spec.ts`
- 修改：`apps/admin-web/src/views/DashboardView.vue`
- 修改：`apps/admin-web/src/views/NotFoundView.vue`
- 修改：`apps/admin-web/src/views/PlaceholderView.vue`

**接口：**

- 消费：任务 4 的布局/空状态组件。
- 保留：登录 data-testid、默认凭据、redirect、submit 与错误反馈。

- [ ] **步骤 1：扩展登录结构测试并观察 RED**

在 `LoginView.spec.ts` 增加：

```ts
expect(wrapper.get('main').classes()).toContain('admin-auth-page');
expect(wrapper.find('[data-testid="admin-brand-art"]').exists()).toBe(true);
expect(wrapper.get('[data-testid="admin-submit"]').text()).toContain('登录');
```

运行：

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/LoginView.spec.ts
```

预期：品牌结构断言 FAIL，登录行为断言不变。

- [ ] **步骤 2：重构登录与 Dashboard**

- 登录使用左右分栏；表单卡为主，右侧用纯 CSS 柔和角色/烘焙贴纸，根 class `admin-auth-page`，装饰节点 `data-testid="admin-brand-art"`。
- Dashboard 删除 Task 11/Task 12 占位文案和伪统计语义，改为欢迎 hero、四个真实功能入口卡和订单状态流程说明；不请求新 API，不展示虚假数字。
- 卡片使用任务 4 的 `AdminPage` / `AdminPageHeader`。

- [ ] **步骤 3：统一 NotFound 与 Placeholder**

使用 `AdminEmptyState`，保留返回/导航行为；空状态插图用 CSS 星芒/贴纸，不拉取远程素材。

- [ ] **步骤 4：运行定向检查**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/LoginView.spec.ts src/router/index.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
```

- [ ] **步骤 5：检查任务 diff，不提交**

```bash
git diff --check -- apps/admin-web/src/views/LoginView.vue apps/admin-web/src/views/DashboardView.vue apps/admin-web/src/views/NotFoundView.vue apps/admin-web/src/views/PlaceholderView.vue
rg -n 'Task 11|Task 12|占位提示|useAdminStatsStore' apps/admin-web/src/views/DashboardView.vue
```

预期：第二条无命中。

---

### 任务 6：迁移 Admin 分类、商品、Banner 与订单列表

**文件：**

- 修改：`apps/admin-web/src/views/CategoriesView.vue`
- 修改：`apps/admin-web/src/views/categories/components/CategoryTable.vue`
- 修改：`apps/admin-web/src/views/categories/components/CreateCategoryDialog.vue`
- 修改：`apps/admin-web/src/views/ProductsView.vue`
- 修改：`apps/admin-web/src/views/products/components/ProductTable.vue`
- 修改：`apps/admin-web/src/views/banners/BannersView.vue`
- 修改：`apps/admin-web/src/views/banners/components/BannerTable.vue`
- 修改：`apps/admin-web/src/views/banners/components/BannerFormDialog.vue`
- 修改：`apps/admin-web/src/views/orders/OrdersView.vue`
- 修改：`apps/admin-web/src/views/orders/components/OrderFilters.vue`
- 修改：`apps/admin-web/src/views/orders/components/OrderTable.vue`
- 修改：`apps/admin-web/src/views/orders/components/OrderDetailDrawer.vue`
- 修改相关现有页面/表格 specs。

**接口：**

- 消费：任务 4 的 `AdminPage`、`AdminPageHeader`、`AdminDataPanel`、`AdminEmptyState`。
- 保留：所有 hooks、emit、API 调用、确认弹窗、筛选字段、分页和状态操作。

- [ ] **步骤 1：为四类页面增加统一结构断言并观察 RED**

在 `CategoriesView.spec.ts`、`ProductsView.spec.ts` 和现有 Banner/订单可挂载测试中增加：

```ts
expect(wrapper.find('.admin-page').exists()).toBe(true);
expect(wrapper.find('.admin-page-header').exists()).toBe(true);
expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
```

表格测试增加：

```ts
expect(wrapper.get('.el-table').classes()).toContain('admin-table');
```

运行相关测试，预期新增断言 FAIL。

- [ ] **步骤 2：迁移分类和商品列表**

- PageHeader 右侧放新增操作；错误 alert 保留在 header 与 data panel 之间。
- CategoryTable/ProductTable 放入 AdminDataPanel，统一 `admin-table` class、表头和空状态。
- 现有删除确认、导航和状态开关不变。

- [ ] **步骤 3：迁移 Banner 和订单列表**

- 删除 `BannersView`、`OrdersView` 各自的渐变 header CSS，改用统一 PageHeader。
- `OrderFilters` 进入 DataPanel toolbar，使用响应式 grid：订单号、状态、履约、日期、按钮；1024px 可换行。
- 表格使用受控 `min-width` 和 data panel 横向滚动。
- `OrderDetailDrawer` 强化快照分组和 sticky action footer；取消警告原文保留。
- Banner/Dialog、CategoryDialog 统一标题、footer 和表单间距。

- [ ] **步骤 4：运行 Admin 列表相关测试**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/CategoriesView.spec.ts src/views/categories/components/CategoryTable.spec.ts src/views/products/ProductsView.spec.ts src/views/products/components/ProductTable.spec.ts src/views/banners/hooks/useBanners.spec.ts src/views/orders/hooks/useOrders.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
```

预期：业务交互断言和结构断言均 PASS。

- [ ] **步骤 5：检查任务 diff，不提交**

```bash
git diff --check -- apps/admin-web/src/views/categories apps/admin-web/src/views/CategoriesView.vue apps/admin-web/src/views/products/ProductsView.vue apps/admin-web/src/views/products/components/ProductTable.vue apps/admin-web/src/views/banners apps/admin-web/src/views/orders
rg -n 'linear-gradient' apps/admin-web/src/views/CategoriesView.vue apps/admin-web/src/views/ProductsView.vue apps/admin-web/src/views/banners/BannersView.vue apps/admin-web/src/views/orders/OrdersView.vue
```

预期：业务页不再各自定义渐变 header。

---

### 任务 7：迁移 Admin 商品编辑器与共享编辑组件

**文件：**

- 修改：`apps/admin-web/src/views/products/ProductEditorView.vue`
- 修改：`apps/admin-web/src/views/products/components/ProductForm.vue`
- 修改：`apps/admin-web/src/views/products/components/ProductImagesEditor.vue`
- 修改：`apps/admin-web/src/views/products/components/SkuTableEditor.vue`
- 修改：`apps/admin-web/src/components/CosImageUploader.vue`
- 修改：`apps/admin-web/src/components/RichTextEditor.vue`
- 修改：`apps/admin-web/src/views/products/ProductEditorView.spec.ts`
- 修改：`apps/admin-web/src/views/products/components/ProductForm.spec.ts`
- 修改：`apps/admin-web/src/views/products/components/ProductImagesEditor.spec.ts`
- 修改：`apps/admin-web/src/views/products/components/SkuTableEditor.spec.ts`
- 修改：`apps/admin-web/src/components/CosImageUploader.spec.ts`
- 修改：`apps/admin-web/src/components/RichTextEditor.spec.ts`

**接口：**

- 消费：任务 4 的页面布局组件。
- 保留：`ProductFormShape`、上传事件、SKU 不可变更新、409 冲突、reload、server preview 和保存 API。

- [ ] **步骤 1：锁定分区与 sticky action 契约并观察 RED**

`ProductForm.spec.ts` 增加：

```ts
expect(
  wrapper
    .findAll('[data-form-section]')
    .map((node) => node.attributes('data-form-section')),
).toEqual(['basic', 'media', 'detail', 'skus', 'publish']);
expect(wrapper.find('.product-form__sticky-actions').exists()).toBe(true);
```

`SkuTableEditor.spec.ts` 增加：

```ts
expect(wrapper.get('[data-testid="sku-table-scroll"]').classes()).toContain(
  'admin-horizontal-scroll',
);
```

运行定向测试，预期新增结构断言 FAIL。

- [ ] **步骤 2：重构 ProductEditorView 与 ProductForm 分区**

- `ProductEditorView` 使用统一 page/header，loading/error/conflict 放在明确 feedback 区。
- `ProductForm` 依次输出 `data-form-section="basic|media|detail|skus|publish"` 五个卡片。
- 保存/取消区使用 `.product-form__sticky-actions`；上传中/保存中禁用逻辑保持原样。
- server response preview 与草稿编辑区明确分开。

- [ ] **步骤 3：统一媒体、富文本与 SKU 编辑器**

- `CosImageUploader` 使用清晰 drop-area/preview/actions 布局，保留原 file input、MIME/大小校验和事件。
- `ProductImagesEditor` 统一图片卡和排序标签。
- `RichTextEditor` toolbar 与 surface 使用统一边框和 focus ring，不改变 DOMPurify/innerHTML 同步。
- `SkuTableEditor` 容器增加 `data-testid="sku-table-scroll"` 和 `admin-horizontal-scroll`，关键输入设置合理 min-width，不压缩成不可操作宽度。

- [ ] **步骤 4：运行商品编辑全套测试与检查**

```bash
pnpm --filter @bake-mall/admin-web test -- src/components/CosImageUploader.spec.ts src/components/RichTextEditor.spec.ts src/views/products/hooks/useSkuEditor.spec.ts src/views/products/hooks/useProductEditor.spec.ts src/views/products/components/ProductImagesEditor.spec.ts src/views/products/components/SkuTableEditor.spec.ts src/views/products/components/ProductForm.spec.ts src/views/products/ProductEditorView.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
```

- [ ] **步骤 5：运行 Admin 完整构建并检查 diff**

```bash
pnpm --filter @bake-mall/admin-web test
pnpm --filter @bake-mall/admin-web build
pnpm --filter @bake-mall/admin-web verify:production-login
git diff --check -- apps/admin-web
```

预期：全部退出码 0，生产登录 bundle 不泄露开发凭据。

---

### 任务 8：真实浏览器多视口验收与最终收敛

**文件：**

- 验证：任务 1–7 的全部 H5/Admin 文件。
- 仅在运行时观察到已确认视觉或流程缺陷时修改对应现有文件/测试。
- 保留：`.claude/skills/verify/SKILL.md`。

**接口：**

- 消费：根 `pnpm dev`、仓库 verify skill、真实 MySQL/MinIO、H5/Admin 默认登录。
- 产出：H5 360/430/560px 与 Admin 1024/1440/1920px 的截图、无溢出证据和流程回归记录。

- [ ] **步骤 1：启动真实应用**

```bash
PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH pnpm dev
```

预期：MySQL/MinIO healthy，无待执行迁移，API `3015`、H5 `5173`、Admin `5174` 可访问。若 `com.claude.bake-mall-dev` 占用端口，先核实 job 指向当前 worktree，再按 `.claude/skills/verify/SKILL.md` 处理。

- [ ] **步骤 2：H5 三视口视觉验收**

使用系统 Chrome CDP，分别设置 360×800、430×900、560×900，逐项观察：

1. 首页 Banner/hero/分类/双列商品/Tabbar 层级清晰。
2. 无 `document.documentElement.scrollWidth > window.innerWidth`。
3. 商品详情 SKU sheet、数量和加入购物车按钮可触控。
4. 登录 redirect → 加购 → 购物车 → 结算 → 自提订单 → 订单详情/列表流程成功。
5. 购物车 fixed action 不遮 Tabbar；结算最后一个字段不被按钮遮挡。
6. 登录、地址、个人中心、空状态没有裸白大块或原生突兀控件。

每个视口保存首页、购物车、结算、订单详情截图到 `/tmp/bake-visual-h5-<width>-*.png`。

- [ ] **步骤 3：Admin 三视口视觉验收**

分别设置 1024×800、1440×1000、1920×1080，逐项观察：

1. 登录页角色装饰不压表单。
2. 侧栏分组、图标、active 状态和 topbar 对齐。
3. Dashboard 没有伪 KPI 或 Task 占位文案。
4. 分类/商品/Banner/订单均遵循 PageHeader → DataPanel。
5. 订单筛选在 1024px 可换行，表格可受控横向滚动。
6. 商品编辑五个分区和 sticky actions 清晰，SKU 输入不被压缩。
7. Banner 弹窗、订单抽屉和取消警告可完整操作。

保存 dashboard、商品列表、商品编辑、订单页截图到 `/tmp/bake-visual-admin-<width>-*.png`。

- [ ] **步骤 4：执行相应级别的最终质量门**

```bash
pnpm --filter @bake-mall/h5-store test
pnpm --filter @bake-mall/h5-store typecheck
pnpm --filter @bake-mall/h5-store lint
pnpm --filter @bake-mall/h5-store build
pnpm --filter @bake-mall/admin-web test
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/admin-web build
pnpm format:check
git diff --check
```

预期：全部退出码 0。若仅因本轮文件格式失败，运行 `pnpm format` 后重新执行受影响检查；不得放宽规则或删除业务断言。

- [ ] **步骤 5：最终审查与清理**

调用一轮相应级别 code review，重点检查：

- 是否改变业务行为或 wire DTO。
- 展示组件是否意外访问 API/store。
- fixed/sticky 区域是否遮挡。
- 是否存在重复 token、硬编码大宽度或局部全局样式泄漏。
- Admin 装饰是否影响数据效率。
- H5 状态是否只靠颜色表达。

清理 `/tmp/bake-visual-*` 和临时 Chrome profile；停止三个应用但保留 MySQL/MinIO。最终 `git status --short` 只包含两端视觉改造、设计/计划以及执行前已有 `.claude/skills/verify/SKILL.md`，不包含构建产物或临时文件。

## 计划自审

### 规格覆盖

| 规格要求                                     | 对应任务 |
| -------------------------------------------- | -------- |
| H5 清透 token、画布、安全区与状态组件        | 任务 1   |
| H5 首页、分类、商品、SKU、Tabbar             | 任务 2   |
| H5 购物车、结算、订单、地址、个人、登录      | 任务 3   |
| Admin token、侧栏、topbar、页面骨架          | 任务 4   |
| Admin 轻二次元品牌入口、Dashboard、空状态    | 任务 5   |
| Admin 分类/商品/Banner/订单统一页面结构      | 任务 6   |
| Admin 商品编辑任务流与共享编辑组件           | 任务 7   |
| 360–560px、1024–1920px、流程优先、真实浏览器 | 任务 8   |

### 占位扫描

已确认计划不含 TBD、TODO、“类似任务”或未定义接口。所有实现任务均给出精确文件、结构契约、定向命令和预期结果。

### 类型与行为一致性

- 新组件仅定义展示 props/slots/emit，不引入 wire DTO。
- `ProductCard.open`、`SkuPicker.add`、表单 submit、列表 hooks 和 Admin 状态操作保持原签名。
- 任务 1/4 先提供布局组件，后续任务只消费已定义接口。
- 最终验收明确覆盖既有 H5 下单与 Admin 管理流程，防止视觉重构改变业务行为。
