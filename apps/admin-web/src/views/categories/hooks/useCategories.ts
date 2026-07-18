/**
 * Encapsulated business logic for the category management view.
 *
 * The hook owns the table state (loading flag, error message, categories
 * list) plus the inline-edit draft. Every mutation reuses
 * {@link categoriesApi}; never touches `fetch` directly. State transitions
 * follow the immutable / spread convention so reactive Vue consumers
 * always observe a brand-new reference.
 */

import { reactive, ref, type Ref } from 'vue';

import { categoriesApi } from '../api/index.js';
import { createCategoryDefaults } from '../config/defaults.js';
import type { AdminCategoryView } from '../../../api/catalog.js';
import type { CategoryFormShape, CategoryInlineEdit } from '../type/form.js';

export type UseCategoriesResult = {
  readonly categories: Ref<readonly AdminCategoryView[]>;
  readonly loading: Ref<boolean>;
  readonly lastError: Ref<string | null>;
  readonly editingId: Ref<string | null>;
  readonly editingDraft: CategoryInlineEdit;
  readonly refresh: () => Promise<void>;
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
  const loading = ref(false);
  const lastError = ref<string | null>(null);
  const editingId = ref<string | null>(null);

  const editingDraft = reactive<CategoryInlineEdit>({
    name: '',
    imageUrl: '',
    sortOrder: 0,
    isActive: true,
  });

  async function refresh(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      categories.value = await categoriesApi.list();
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : '分类加载失败';
    } finally {
      loading.value = false;
    }
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
    editingDraft.name = category.name;
    editingDraft.imageUrl = category.imageUrl ?? '';
    editingDraft.sortOrder = category.sortOrder;
    editingDraft.isActive = category.isActive;
  }

  function cancelEdit(): void {
    editingId.value = null;
  }

  async function saveEdit(
    category: AdminCategoryView,
  ): Promise<AdminCategoryView> {
    const trimmedName = editingDraft.name.trim();
    if (!trimmedName) {
      throw new Error('分类名称不能为空');
    }
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
    if (!trimmedName) {
      throw new Error('分类名称不能为空');
    }
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
    loading,
    lastError,
    editingId,
    editingDraft,
    refresh,
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
