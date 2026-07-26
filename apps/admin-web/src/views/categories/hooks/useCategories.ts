import type {
  AdminCategoryListQuery,
  AdminCategoryView,
} from '@bake-mall/contracts';
import { computed, reactive, ref, type Ref } from 'vue';

import { countActiveFilters } from '../../../utils/list-query.js';
import { categoriesApi } from '../api/index.js';
import {
  createCategoryDefaults,
  createCategoryFilterDefaults,
} from '../config/defaults.js';
import { CATEGORY_PAGINATION } from '../config/pagination.js';
import type { CategoryFormShape, CategoryInlineEdit } from '../type/form.js';
import type { CategoryFilterForm } from '../type/list.js';

const cloneFilters = (filters: CategoryFilterForm): CategoryFilterForm => ({
  ...filters,
  createdAtRange: filters.createdAtRange ? [...filters.createdAtRange] : null,
});

const toQuery = (
  filters: CategoryFilterForm,
  page: number,
  pageSize: number,
): AdminCategoryListQuery => ({
  ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
  ...(filters.isActive ? { isActive: filters.isActive } : {}),
  ...(filters.hasImage ? { hasImage: filters.hasImage } : {}),
  ...(filters.hasProducts ? { hasProducts: filters.hasProducts } : {}),
  ...(filters.createdAtRange
    ? {
        createdAtFrom: filters.createdAtRange[0],
        createdAtBefore: filters.createdAtRange[1],
      }
    : {}),
  page,
  pageSize,
});

export type UseCategoriesResult = {
  readonly categories: Ref<readonly AdminCategoryView[]>;
  readonly draftFilters: CategoryFilterForm;
  readonly advancedCount: Readonly<Ref<number>>;
  readonly hasAppliedFilters: Readonly<Ref<boolean>>;
  readonly page: Ref<number>;
  readonly pageSize: Ref<number>;
  readonly total: Ref<number>;
  readonly loading: Ref<boolean>;
  readonly lastError: Ref<string | null>;
  readonly editingId: Ref<string | null>;
  readonly editingDraft: CategoryInlineEdit;
  readonly refresh: () => Promise<void>;
  readonly search: () => Promise<void>;
  readonly reset: () => Promise<void>;
  readonly setPage: (value: number) => Promise<void>;
  readonly setPageSize: (value: number) => Promise<void>;
  readonly nextSortOrder: () => number;
  readonly blankForm: () => CategoryFormShape;
  readonly startEdit: (category: AdminCategoryView) => void;
  readonly cancelEdit: () => void;
  readonly saveEdit: (
    category: AdminCategoryView,
  ) => Promise<AdminCategoryView>;
  readonly create: (form: CategoryFormShape) => Promise<AdminCategoryView>;
  readonly remove: (category: AdminCategoryView) => Promise<void>;
  readonly toggleActive: (
    category: AdminCategoryView,
  ) => Promise<AdminCategoryView>;
};

export function useCategories(): UseCategoriesResult {
  const categories = ref<readonly AdminCategoryView[]>([]);
  const draftFilters = reactive<CategoryFilterForm>(
    createCategoryFilterDefaults(),
  );
  const appliedFilters = ref<CategoryFilterForm>(
    createCategoryFilterDefaults(),
  );
  const page = ref<number>(CATEGORY_PAGINATION.defaultPage);
  const pageSize = ref<number>(CATEGORY_PAGINATION.defaultPageSize);
  const total = ref(0);
  const loading = ref(false);
  const lastError = ref<string | null>(null);
  const editingId = ref<string | null>(null);
  const editingDraft = reactive<CategoryInlineEdit>({
    name: '',
    imageUrl: '',
    sortOrder: 0,
    isActive: true,
  });
  let refreshSequence = 0;

  const advancedCount = computed(() =>
    countActiveFilters({
      hasImage: appliedFilters.value.hasImage,
      hasProducts: appliedFilters.value.hasProducts,
      createdAtRange: appliedFilters.value.createdAtRange,
    }),
  );
  const hasAppliedFilters = computed(
    () =>
      countActiveFilters({
        ...appliedFilters.value,
        createdAtRange: appliedFilters.value.createdAtRange,
      }) > 0,
  );

  async function refresh(): Promise<void> {
    const sequence = refreshSequence + 1;
    refreshSequence = sequence;
    loading.value = true;
    lastError.value = null;
    try {
      const result = await categoriesApi.list(
        toQuery(appliedFilters.value, page.value, pageSize.value),
      );
      if (sequence !== refreshSequence) return;
      categories.value = [...result.items];
      page.value = result.page;
      pageSize.value = result.pageSize;
      total.value = result.total;
    } catch (error) {
      if (sequence === refreshSequence) {
        lastError.value =
          error instanceof Error ? error.message : '分类加载失败';
      }
    } finally {
      if (sequence === refreshSequence) loading.value = false;
    }
  }

  async function search(): Promise<void> {
    appliedFilters.value = cloneFilters(draftFilters);
    page.value = 1;
    await refresh();
  }

  async function reset(): Promise<void> {
    const defaults = createCategoryFilterDefaults();
    Object.assign(draftFilters, defaults);
    appliedFilters.value = defaults;
    page.value = 1;
    await refresh();
  }

  async function setPage(value: number): Promise<void> {
    page.value = value;
    await refresh();
  }

  async function setPageSize(value: number): Promise<void> {
    pageSize.value = value;
    page.value = 1;
    await refresh();
  }

  function nextSortOrder(): number {
    if (categories.value.length === 0) return 0;
    const max = Math.max(...categories.value.map((row) => row.sortOrder ?? 0));
    return Number.isFinite(max) ? max + 1 : 0;
  }

  function blankForm(): CategoryFormShape {
    return { ...createCategoryDefaults(), sortOrder: nextSortOrder() };
  }

  function startEdit(category: AdminCategoryView): void {
    editingId.value = category.id;
    Object.assign(editingDraft, {
      name: category.name,
      imageUrl: category.imageUrl ?? '',
      sortOrder: category.sortOrder,
      isActive: category.isActive,
    });
  }

  function cancelEdit(): void {
    editingId.value = null;
  }

  async function saveEdit(
    category: AdminCategoryView,
  ): Promise<AdminCategoryView> {
    const trimmedName = editingDraft.name.trim();
    if (!trimmedName) throw new Error('分类名称不能为空');
    const trimmedImage = editingDraft.imageUrl.trim();
    const updated = await categoriesApi.update(category.id, {
      name: trimmedName,
      sortOrder: editingDraft.sortOrder,
      isActive: editingDraft.isActive,
      ...(trimmedImage ? { imageUrl: trimmedImage } : {}),
    });
    editingId.value = null;
    await refresh();
    return updated;
  }

  async function create(form: CategoryFormShape): Promise<AdminCategoryView> {
    const trimmedName = form.name.trim();
    if (!trimmedName) throw new Error('分类名称不能为空');
    const trimmedImage = form.imageUrl.trim();
    const created = await categoriesApi.create({
      name: trimmedName,
      sortOrder: form.sortOrder,
      isActive: form.isActive,
      ...(trimmedImage ? { imageUrl: trimmedImage } : {}),
    });
    await refresh();
    return created;
  }

  async function remove(category: AdminCategoryView): Promise<void> {
    await categoriesApi.remove(category.id);
    await refresh();
  }

  async function toggleActive(
    category: AdminCategoryView,
  ): Promise<AdminCategoryView> {
    const updated = await categoriesApi.update(category.id, {
      isActive: !category.isActive,
    });
    await refresh();
    return updated;
  }

  return {
    categories,
    draftFilters,
    advancedCount,
    hasAppliedFilters,
    page,
    pageSize,
    total,
    loading,
    lastError,
    editingId,
    editingDraft,
    refresh,
    search,
    reset,
    setPage,
    setPageSize,
    nextSortOrder,
    blankForm,
    startEdit,
    cancelEdit,
    saveEdit,
    create,
    remove,
    toggleActive,
  };
}
