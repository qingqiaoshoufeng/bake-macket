import type {
  AdminCategoryView,
  AdminHomepageView,
  AdminProductSummaryView,
  HomepageDraftConfig,
} from '@bake-mall/contracts';
import { computed, ref } from 'vue';

import { ApiClientError } from '../../../api/http.js';
import { cloneJson } from '../../../utils/json.js';
import { loadAllCategories } from '../../categories/hooks/loadAllCategories.js';
import { loadAllProducts } from '../../products/hooks/loadAllProducts.js';
import { homepageApi } from '../api/index.js';
import { createHomepageDraft } from '../config/defaults.js';

const clone = (value: HomepageDraftConfig): HomepageDraftConfig =>
  cloneJson(value);

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useHomepageEditor() {
  const draftId = ref<string | null>(null);
  const name = ref<string | undefined>();
  const status = ref<AdminHomepageView['status']>();
  const draft = ref<HomepageDraftConfig>(createHomepageDraft());
  const categories = ref<readonly AdminCategoryView[]>([]);
  const products = ref<readonly AdminProductSummaryView[]>([]);
  const version = ref(1);
  const publishedVersion = ref<number | undefined>();
  const publishedAt = ref<string | undefined>();
  const updatedAt = ref<string | undefined>();
  const createdAt = ref<string | undefined>();
  const issues = ref<AdminHomepageView['draftIssues']>([]);
  const loading = ref(false);
  const saving = ref(false);
  const publishing = ref(false);
  const dirty = ref(false);
  const conflict = ref<string | null>(null);
  const lastError = ref<string | null>(null);
  let catalogPromise: Promise<void> | null = null;

  const canPublish = computed(
    () => !dirty.value && !saving.value && !publishing.value,
  );

  function applyView(view: AdminHomepageView): void {
    draftId.value = view.id;
    name.value = view.name;
    status.value = view.status;
    draft.value = clone(view.draftConfig);
    version.value = view.version;
    publishedVersion.value = view.publishedVersion;
    publishedAt.value = view.publishedAt;
    updatedAt.value = view.updatedAt ?? view.draftUpdatedAt;
    createdAt.value = view.createdAt;
    issues.value = [...view.draftIssues];
    dirty.value = false;
    conflict.value = null;
  }

  async function loadCatalog(): Promise<void> {
    const [loadedCategories, loadedProducts] = await Promise.all([
      loadAllCategories(),
      loadAllProducts(),
    ]);
    const activeCategories = loadedCategories.filter(
      ({ isActive }) => isActive,
    );
    const activeCategoryIds = new Set(activeCategories.map(({ id }) => id));
    categories.value = activeCategories;
    products.value = loadedProducts.filter(
      ({ isActive, categoryId }) =>
        isActive && activeCategoryIds.has(categoryId),
    );
  }

  function ensureCatalog(): Promise<void> {
    if (catalogPromise) return catalogPromise;
    catalogPromise = loadCatalog().catch((error: unknown) => {
      catalogPromise = null;
      throw error;
    });
    return catalogPromise;
  }

  async function load(id?: string): Promise<void> {
    const nextId = id ?? draftId.value;
    if (!nextId) throw new Error('请先选择首页草稿');
    loading.value = true;
    lastError.value = null;
    try {
      const [view] = await Promise.all([
        homepageApi.getOne(nextId),
        ensureCatalog(),
      ]);
      applyView(view);
    } catch (error) {
      lastError.value = errorMessage(error, '首页配置加载失败');
      throw error;
    } finally {
      loading.value = false;
    }
  }

  function replaceDraft(value: HomepageDraftConfig): void {
    draft.value = clone(value);
    dirty.value = true;
  }

  function applyApiError(error: unknown): void {
    if (!(error instanceof ApiClientError)) return;
    if (error.status === 409) conflict.value = error.message;
    if (error.status !== 422) return;
    const nextIssues = error.details?.issues;
    if (Array.isArray(nextIssues)) {
      issues.value = nextIssues as AdminHomepageView['draftIssues'];
    }
  }

  function requireDraftId(): string {
    if (!draftId.value) throw new Error('请先选择首页草稿');
    return draftId.value;
  }

  async function saveDraft(): Promise<AdminHomepageView> {
    const id = requireDraftId();
    saving.value = true;
    lastError.value = null;
    try {
      const saved = await homepageApi.saveDraft(id, {
        config: clone(draft.value),
        version: version.value,
      });
      applyView(saved);
      return saved;
    } catch (error) {
      applyApiError(error);
      lastError.value = errorMessage(error, '草稿保存失败');
      throw error;
    } finally {
      saving.value = false;
    }
  }

  async function publish(): Promise<AdminHomepageView> {
    if (dirty.value) throw new Error('请先保存草稿再发布');
    const id = requireDraftId();
    publishing.value = true;
    lastError.value = null;
    try {
      const published = await homepageApi.publish(id, {
        version: version.value,
      });
      applyView(published);
      return published;
    } catch (error) {
      applyApiError(error);
      lastError.value = errorMessage(error, '首页发布失败');
      throw error;
    } finally {
      publishing.value = false;
    }
  }

  return {
    draftId,
    name,
    status,
    draft,
    categories,
    products,
    version,
    publishedVersion,
    publishedAt,
    updatedAt,
    createdAt,
    issues,
    loading,
    saving,
    publishing,
    dirty,
    conflict,
    lastError,
    canPublish,
    load,
    replaceDraft,
    saveDraft,
    publish,
  };
}
