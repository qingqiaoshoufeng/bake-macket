# Admin Category Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing single-level merchant category manager reachable at `/categories`, restore its regressed table and loading-error behavior, and lock the complete category flow with focused tests.

**Architecture:** Keep `CategoriesView.vue` as the orchestration edge, `useCategories.ts` as the async business-state owner, and the child components as presentation-only emitters. Route the authenticated admin child directly to the existing view, consume pure column configuration in `CategoryTable.vue`, and use the existing feature mock as the canonical test fixture.

**Tech Stack:** Vue 3.5, Vue Router 4.4, Element Plus 2.9, TypeScript 5.8, Vitest 3.2, Vue Test Utils 2.4, pnpm 9.15.4.

## Global Constraints

- Work only in `apps/admin-web/`; do not add product, Banner, or order management in this slice.
- Preserve the existing uncommitted `apps/admin-web/src/views/categories/components/CategoryTable.vue:51` change exactly in behavior: Element Plus receives `:data="[...categories]"` rather than the readonly prop reference.
- Categories remain single-level and expose name, image URL, sort order, and active status, as required by `docs/superpowers/specs/2026-07-12-bake-mall-design.md`.
- All category HTTP calls continue through `apps/admin-web/src/views/categories/api/index.ts` and the global catalog client; components must not fetch.
- Keep child-component props local to each `.vue` file; shared page form types remain under `views/categories/type/`.
- Use immutable ES6 transforms; no `push`, mutable sorting, duplicated enum labels, or imperative collection loops.
- Do not change the backend contract for clearing an existing category image; an empty edit continues to omit `imageUrl`.
- Do not commit unless the user explicitly asks for a commit.

## File Map

- Create `apps/admin-web/src/router/index.spec.ts` — route-to-view wiring contract.
- Modify `apps/admin-web/src/router/index.ts` — lazy-load `CategoriesView.vue` for `/categories` and update the stale route comment.
- Create `apps/admin-web/src/views/categories/components/CategoryTable.spec.ts` — table configuration, status rendering, and emitted-action contract using `categoryListMock`.
- Modify `apps/admin-web/src/views/categories/config/columns.ts` — preserve pure column data while retaining tuple inference for component consumption.
- Modify `apps/admin-web/src/views/categories/components/CategoryTable.vue` — consume column configuration, restore `row-key`, and render status tags without losing the readonly-array adapter.
- Create `apps/admin-web/src/views/categories/hooks/useCategories.spec.ts` — business-state and API orchestration contract.
- Create `apps/admin-web/src/views/CategoriesView.spec.ts` — first-load failure notification contract.
- Modify `apps/admin-web/src/views/CategoriesView.vue` — watch `lastError` and report it through Element Plus.

---

### Task 1: Route `/categories` to the Real Category View

**Files:**

- Create: `apps/admin-web/src/router/index.spec.ts`
- Modify: `apps/admin-web/src/router/index.ts:21-25,48-51`

**Interfaces:**

- Consumes: exported singleton `router` from `apps/admin-web/src/router/index.ts`; default SFC export from `apps/admin-web/src/views/CategoriesView.vue`.
- Produces: the `admin-categories` route lazy loader resolves to `CategoriesView.vue` while the remaining Task 12 routes continue to resolve to `PlaceholderView.vue`.

- [ ] **Step 1: Write the failing route wiring test**

Create `apps/admin-web/src/router/index.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import CategoriesView from '../views/CategoriesView.vue';
import { router } from './index.js';

type LazyViewModule = {
  readonly default: unknown;
};

type LazyViewLoader = () => Promise<LazyViewModule>;

describe('admin category route', () => {
  it('lazy-loads the real category management view', async () => {
    const categoryRecord = router
      .resolve('/categories')
      .matched.find((record) => record.name === 'admin-categories');
    const component = categoryRecord?.components?.default;

    expect(typeof component).toBe('function');

    const loaded = await (component as LazyViewLoader)();
    expect(loaded.default).toBe(CategoriesView);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the intended failure**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- src/router/index.spec.ts
```

Expected: FAIL because the resolved module default is `PlaceholderView`, not `CategoriesView`.

- [ ] **Step 3: Point only the category route at the real view**

In `apps/admin-web/src/router/index.ts`, replace the stale multi-route placeholder comment with:

```ts
 * `/dashboard` / `/categories` / `/products` / `/banners` / `/orders` are
 * nested children of {@link AdminLayout} so the sidebar, topbar and mobile
 * narrow-screen hint wrap every authenticated view. Category management is
 * implemented by Task 12; the remaining Task 12 children still use
 * {@link PlaceholderView} until their own vertical slices are complete.
```

Change only the category component loader:

```ts
      {
        path: 'categories',
        name: 'admin-categories',
        component: () => import('../views/CategoriesView.vue'),
      },
```

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- src/router/index.spec.ts
```

Expected: PASS with one route test.

- [ ] **Step 5: Inspect the task diff without committing**

Run:

```bash
git diff --check -- apps/admin-web/src/router/index.ts apps/admin-web/src/router/index.spec.ts
```

Expected: no output. Confirm that product, Banner, and order route loaders still target `PlaceholderView.vue`.

---

### Task 2: Restore the Configured Category Table Contract

**Files:**

- Create: `apps/admin-web/src/views/categories/components/CategoryTable.spec.ts`
- Modify: `apps/admin-web/src/views/categories/config/columns.ts:25-32`
- Modify: `apps/admin-web/src/views/categories/components/CategoryTable.vue:11-164`

**Interfaces:**

- Consumes: `CATEGORY_COLUMNS`, `ACTIVE_LABEL`, `INACTIVE_LABEL`, `categoryListMock`, and local component props/events.
- Produces: a table with stable row identity (`row-key="id"`), configured labels and widths, visible active/inactive tags, and the existing `toggle-active`, `start-edit`, `save-edit`, `cancel-edit`, and `remove` events.

- [ ] **Step 1: Write the failing table tests**

Create `apps/admin-web/src/views/categories/components/CategoryTable.spec.ts`:

```ts
import { mount, type VueWrapper } from '@vue/test-utils';
import { ElTable, ElTableColumn } from 'element-plus';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CATEGORY_COLUMNS } from '../config/columns.js';
import { ACTIVE_LABEL, INACTIVE_LABEL } from '../config/defaults.js';
import { categoryListMock } from '../mock/list.mock.js';
import CategoryTable from './CategoryTable.vue';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function mountTable(): VueWrapper {
  return mount(CategoryTable, {
    props: {
      categories: categoryListMock,
      loading: false,
      editingId: null,
      draft: {
        name: '',
        imageUrl: '',
        sortOrder: 0,
        isActive: true,
      },
    },
  });
}

describe('CategoryTable', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('uses stable row identity and every configured column', () => {
    const wrapper = mountTable();
    const table = wrapper.findComponent(ElTable);
    const columnProps = wrapper
      .findAllComponents(ElTableColumn)
      .map((column) => column.props());

    expect(table.props('rowKey')).toBe('id');
    expect(columnProps).toHaveLength(CATEGORY_COLUMNS.length);
    expect(columnProps.map(({ label }) => label)).toEqual(
      CATEGORY_COLUMNS.map(({ label }) => label),
    );
  });

  it('shows active and inactive labels from the shared defaults', () => {
    const wrapper = mountTable();

    expect(wrapper.text()).toContain(ACTIVE_LABEL);
    expect(wrapper.text()).toContain(INACTIVE_LABEL);
  });

  it('emits row actions without mutating the readonly category input', async () => {
    const original = structuredClone(categoryListMock);
    const category = categoryListMock[0];
    const wrapper = mountTable();

    await wrapper.get(`[data-testid="edit-${category.id}"]`).trigger('click');
    await wrapper
      .get(`[data-testid="category-active-${category.id}"]`)
      .trigger('click');
    await wrapper.get(`[data-testid="delete-${category.id}"]`).trigger('click');

    expect(wrapper.emitted('start-edit')?.[0]).toEqual([category]);
    expect(wrapper.emitted('toggle-active')?.[0]).toEqual([category]);
    expect(wrapper.emitted('remove')?.[0]).toEqual([category]);
    expect(categoryListMock).toEqual(original);
  });
});
```

- [ ] **Step 2: Run the tests and confirm the regression is caught**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/categories/components/CategoryTable.spec.ts
```

Expected: FAIL because `rowKey` is absent, the status column is absent, and active/inactive labels are not rendered.

If Element Plus emits harmless layout warnings under jsdom, keep assertions focused on props/text/events. Do not replace `CategoryTable` with a fake component because the test must exercise the real table contract.

- [ ] **Step 3: Preserve tuple inference in the pure column config**

Change the declaration in `apps/admin-web/src/views/categories/config/columns.ts` to:

```ts
export const CATEGORY_COLUMNS = [
  { key: 'name', label: '名称', minWidth: 200 },
  { key: 'image', label: '图标/图片', minWidth: 220 },
  { key: 'sortOrder', label: '排序', width: 120 },
  { key: 'isActive', label: '启用', width: 120 },
  { key: 'status', label: '状态', width: 120 },
  { key: 'actions', label: '操作', width: 220, align: 'left' },
] as const satisfies readonly ColumnDef[];
```

This remains pure data while allowing safe tuple destructuring in the component.

- [ ] **Step 4: Consume the config and restore table identity/status**

In `CategoryTable.vue`, import the column config:

```ts
import { CATEGORY_COLUMNS } from '../config/columns.js';
import { ACTIVE_LABEL, INACTIVE_LABEL } from '../config/defaults.js';
```

After `defineEmits`, destructure the fixed tuple:

```ts
const [
  nameColumn,
  imageColumn,
  sortOrderColumn,
  activeColumn,
  statusColumn,
  actionsColumn,
] = CATEGORY_COLUMNS;
```

Keep the existing readonly adapter and add row identity:

```vue
  <ElTable
    v-loading="loading"
    :data="[...categories]"
    row-key="id"
    :empty-text="'暂无分类'"
    :data-testid="'categories-table'"
  >
```

Remove the no-op `@row-click` handler. Replace hard-coded column labels/sizing with the corresponding config values. For example:

```vue
    <ElTableColumn
      :label="nameColumn.label"
      :min-width="nameColumn.minWidth"
    >
```

Use `:width="sortOrderColumn.width"`, `:width="activeColumn.width"`, and `:width="actionsColumn.width"` for fixed-width columns. Add the status column between active and actions:

```vue
<ElTableColumn :label="statusColumn.label" :width="statusColumn.width">
      <template #default="{ row }">
        <ElTag
          :type="row.isActive ? 'success' : 'info'"
          :data-testid="`category-status-${row.id}`"
        >
          {{ row.isActive ? ACTIVE_LABEL : INACTIVE_LABEL }}
        </ElTag>
      </template>
    </ElTableColumn>
```

Configure the actions column with:

```vue
    <ElTableColumn
      :label="actionsColumn.label"
      :width="actionsColumn.width"
      :align="actionsColumn.align"
    >
```

Do not alter event payloads or the `asCategory` boundary cast.

- [ ] **Step 5: Run the focused tests and lint the touched table files**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/categories/components/CategoryTable.spec.ts
pnpm --filter @bake-mall/admin-web lint
```

Expected: all table tests PASS; lint reports no unused `ACTIVE_LABEL`/`INACTIVE_LABEL` imports and no Vue template errors.

- [ ] **Step 6: Inspect the task diff without committing**

Run:

```bash
git diff --check -- apps/admin-web/src/views/categories/config/columns.ts apps/admin-web/src/views/categories/components/CategoryTable.vue apps/admin-web/src/views/categories/components/CategoryTable.spec.ts
```

Expected: no output. Explicitly confirm the diff still contains `:data="[...categories]"`.

---

### Task 3: Lock `useCategories` Business Orchestration

**Files:**

- Create: `apps/admin-web/src/views/categories/hooks/useCategories.spec.ts`
- Verify without changing unless a test reveals a defect: `apps/admin-web/src/views/categories/hooks/useCategories.ts`

**Interfaces:**

- Consumes: `categoriesApi`, `categoryListMock`, `CategoryFormShape`, and `AdminCategoryView`.
- Produces: tested contracts for loading/error state, next sort order, trimmed create/update payloads, edit lifecycle, active toggling, deletion, and post-mutation refresh.

- [ ] **Step 1: Add API-mocked hook tests**

Create `apps/admin-web/src/views/categories/hooks/useCategories.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { categoriesApi } from '../api/index.js';
import { categoryListMock } from '../mock/list.mock.js';
import { useCategories } from './useCategories.js';

vi.mock('../api/index.js', () => ({
  categoriesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(categoriesApi);
const firstCategory = categoryListMock[0];
const lastCategory = categoryListMock[2];

describe('useCategories', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.list.mockResolvedValue([...categoryListMock]);
  });

  it('loads categories and derives the next sort order', async () => {
    const state = useCategories();

    await state.refresh();

    expect(state.loading.value).toBe(false);
    expect(state.lastError.value).toBeNull();
    expect(state.categories.value).toEqual(categoryListMock);
    expect(state.nextSortOrder()).toBe(3);
    expect(state.blankForm()).toEqual({
      name: '',
      imageUrl: '',
      sortOrder: 3,
      isActive: true,
    });
  });

  it('captures a list failure and always clears loading', async () => {
    api.list.mockRejectedValueOnce(new Error('分类接口不可用'));
    const state = useCategories();

    await state.refresh();

    expect(state.loading.value).toBe(false);
    expect(state.categories.value).toEqual([]);
    expect(state.lastError.value).toBe('分类接口不可用');
  });

  it('trims create input, omits an empty image, and refreshes', async () => {
    api.create.mockResolvedValueOnce(firstCategory);
    const state = useCategories();

    const created = await state.create({
      name: '  生日蛋糕  ',
      imageUrl: '   ',
      sortOrder: 4,
      isActive: true,
    });

    expect(api.create).toHaveBeenCalledWith({
      name: '生日蛋糕',
      sortOrder: 4,
      isActive: true,
    });
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(created).toEqual(firstCategory);
  });

  it('starts, saves, and closes inline editing with a trimmed payload', async () => {
    api.update.mockResolvedValueOnce(firstCategory);
    const state = useCategories();

    state.startEdit(firstCategory);
    state.editingDraft.name = '  节日蛋糕  ';
    state.editingDraft.imageUrl = ' https://cdn.example.com/holiday.png ';
    state.editingDraft.sortOrder = 5;
    state.editingDraft.isActive = false;
    await state.saveEdit(firstCategory);

    expect(api.update).toHaveBeenCalledWith(firstCategory.id, {
      name: '节日蛋糕',
      imageUrl: 'https://cdn.example.com/holiday.png',
      sortOrder: 5,
      isActive: false,
    });
    expect(state.editingId.value).toBeNull();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('toggles active state and deletes by id, refreshing after each call', async () => {
    api.update.mockResolvedValueOnce({ ...lastCategory, isActive: true });
    const state = useCategories();

    await state.toggleActive(lastCategory);
    await state.remove(firstCategory);

    expect(api.update).toHaveBeenCalledWith(lastCategory.id, {
      isActive: true,
    });
    expect(api.remove).toHaveBeenCalledWith(firstCategory.id);
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('rejects blank names before calling create or update', async () => {
    const state = useCategories();

    await expect(
      state.create({
        name: '   ',
        imageUrl: '',
        sortOrder: 0,
        isActive: true,
      }),
    ).rejects.toThrow('分类名称不能为空');

    state.startEdit(firstCategory);
    state.editingDraft.name = '   ';
    await expect(state.saveEdit(firstCategory)).rejects.toThrow(
      '分类名称不能为空',
    );

    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the hook contract tests**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/categories/hooks/useCategories.spec.ts
```

Expected: PASS against the existing hook. These are characterization tests for already-written business logic, not a reason to manufacture a production-code change.

- [ ] **Step 3: Fix only defects actually exposed by the tests**

If a test fails because production behavior contradicts the confirmed design, make the smallest change in `useCategories.ts`. Preserve these invariants:

```ts
categories.value = await categoriesApi.list();
```

```ts
const trimmedName = form.name.trim();
```

```ts
...(trimmedImage ? { imageUrl: trimmedImage } : {}),
```

```ts
await refresh();
```

Do not change empty-image behavior and do not move API mapping into `api/index.ts`.

- [ ] **Step 4: Re-run hook tests and typecheck**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/categories/hooks/useCategories.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
```

Expected: all hook tests PASS and `vue-tsc` exits 0.

- [ ] **Step 5: Inspect the task diff without committing**

Run:

```bash
git diff --check -- apps/admin-web/src/views/categories/hooks/useCategories.ts apps/admin-web/src/views/categories/hooks/useCategories.spec.ts
```

Expected: no output.

---

### Task 4: Surface Initial Category Load Failures

**Files:**

- Create: `apps/admin-web/src/views/CategoriesView.spec.ts`
- Modify: `apps/admin-web/src/views/CategoriesView.vue:13,25-39,130`

**Interfaces:**

- Consumes: `lastError: Ref<string | null>` returned by `useCategories` and `ElMessage.error(message)` from Element Plus.
- Produces: every non-null category refresh error becomes a visible merchant notification; successful loading does not emit an error.

- [ ] **Step 1: Write the failing view error-notification test**

Create `apps/admin-web/src/views/CategoriesView.spec.ts`:

```ts
import { shallowMount } from '@vue/test-utils';
import { ElMessage } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { categoriesApi } from './categories/api/index.js';
import CategoriesView from './CategoriesView.vue';

vi.mock('./categories/api/index.js', () => ({
  categoriesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const api = vi.mocked(categoriesApi);

describe('CategoriesView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it('shows the initial category loading error to the merchant', async () => {
    api.list.mockRejectedValueOnce(new Error('分类接口不可用'));
    const errorMessage = vi
      .spyOn(ElMessage, 'error')
      .mockImplementation(() => undefined as never);

    shallowMount(CategoriesView);
    await vi.waitFor(() => {
      expect(errorMessage).toHaveBeenCalledWith('分类接口不可用');
    });
  });

  it('does not show an error after a successful initial load', async () => {
    api.list.mockResolvedValueOnce([]);
    const errorMessage = vi
      .spyOn(ElMessage, 'error')
      .mockImplementation(() => undefined as never);

    shallowMount(CategoriesView);
    await vi.waitFor(() => {
      expect(api.list).toHaveBeenCalledTimes(1);
    });

    expect(errorMessage).not.toHaveBeenCalled();
  });
});
```

If Element Plus's overloaded `ElMessage.error` type rejects the `mockImplementation` return, omit `.mockImplementation(...)`; the spy can call the real message service under jsdom while still recording the call.

- [ ] **Step 2: Run the focused test and confirm the silent-failure regression**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/CategoriesView.spec.ts
```

Expected: the failure-notification test FAILS because `CategoriesView.vue` currently discards `lastError` with `void lastError`.

- [ ] **Step 3: Watch the hook error at the view side-effect boundary**

Update the Vue import:

```ts
import { onMounted, reactive, ref, watch } from 'vue';
```

After `onMounted(refresh)`, add a named watcher callback:

```ts
function showLoadError(error: string | null): void {
  if (error) {
    ElMessage.error(error);
  }
}

watch(lastError, showLoadError);
```

Delete:

```ts
void lastError;
```

Keep mutation-specific success/error messages unchanged. The hook remains UI-framework independent; `ElMessage` stays at the view edge.

- [ ] **Step 4: Run the view tests and the complete category test set**

Run:

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/CategoriesView.spec.ts
pnpm --filter @bake-mall/admin-web test -- src/router/index.spec.ts src/views/CategoriesView.spec.ts src/views/categories/components/CategoryTable.spec.ts src/views/categories/hooks/useCategories.spec.ts
```

Expected: both view tests PASS and the complete category-focused set passes.

- [ ] **Step 5: Inspect the task diff without committing**

Run:

```bash
git diff --check -- apps/admin-web/src/views/CategoriesView.vue apps/admin-web/src/views/CategoriesView.spec.ts
```

Expected: no output.

---

### Task 5: Validate the Complete Admin Category Slice

**Files:**

- Verify: all changed files listed above.
- Do not modify unrelated files to make checks pass.

**Interfaces:**

- Consumes: the completed route, view, hook, config, component, and tests.
- Produces: evidence that the category slice passes package checks and renders through the real SPA route.

- [ ] **Step 1: Run the full admin-web quality gate**

Run each command independently so a failure is attributable:

```bash
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web test
pnpm --filter @bake-mall/admin-web build
```

Expected: all four commands exit 0. The test command includes the pre-existing auth and SKU tests plus the new category tests.

- [ ] **Step 2: Review the final diff and protected line**

Run:

```bash
git diff --check
git diff -- apps/admin-web/src/views/categories/components/CategoryTable.vue
```

Expected: `git diff --check` prints nothing, and the table diff retains `:data="[...categories]"`.

- [ ] **Step 3: Drive the real SPA route**

Invoke the repository `run` skill to launch `@bake-mall/admin-web`, establish an authenticated admin session using the project's supported local flow, and visit `/categories`.

Observe all of the following in the rendered application:

1. The page heading is `分类管理`, not the Task 12 placeholder copy.
2. The table shows columns `名称`, `图标/图片`, `排序`, `启用`, `状态`, and `操作`.
3. Active and inactive mock/API rows show `已启用` and `已停用` status tags when those states are present.
4. `新增分类` opens the dialog and initializes sort order after the current maximum.
5. Edit, active toggle, and delete controls are visible and invoke their normal API-backed flows in the available environment.
6. A forced category-list failure produces the visible `ElMessage.error` message rather than failing silently.

If backend services or credentials are unavailable, report the exact blocked runtime checks; do not claim end-to-end verification from unit tests alone.

- [ ] **Step 4: Run end-to-end change verification**

Invoke the repository `verify` skill for the category-management runtime surface. Provide it the route `/categories`, the expected visible heading/status labels, and the mutation controls as the affected flow.

Expected: verification observes the real category page and records whether each runtime assertion passed.

- [ ] **Step 5: Request code review before completion**

Invoke `superpowers:requesting-code-review` against the working-tree diff. Review specifically for:

- accidental loss of the user's `:data="[...categories]"` change;
- route regressions or accidental replacement of other placeholder routes;
- silent error paths;
- component business logic or direct fetch calls;
- mutation of readonly fixtures/props;
- config or mock files that remain unused;
- insufficient coverage of category CRUD orchestration.

Apply only confirmed fixes, then re-run the affected focused test and the full admin-web quality gate.

- [ ] **Step 6: Report completion without committing**

Summarize changed files, test/build/runtime results, any runtime limitation, and the deliberately deferred empty-image contract. Leave the working tree uncommitted unless the user explicitly requests a commit.
