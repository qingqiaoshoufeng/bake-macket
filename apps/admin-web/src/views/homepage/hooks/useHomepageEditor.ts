import type {
  AdminCategoryView,
  AdminHomepageView,
  AdminProductSummaryView,
  HomepageDraftConfig,
} from '@bake-mall/contracts';
import { computed, ref } from 'vue';

import { ApiClientError } from '../../../api/http.js';
import { loadAllCategories } from '../../categories/hooks/loadAllCategories.js';
import { loadAllProducts } from '../../products/hooks/loadAllProducts.js';
import { homepageApi } from '../api/index.js';
import { createHomepageDraft } from '../config/defaults.js';

const clone = (value: HomepageDraftConfig): HomepageDraftConfig =>
  structuredClone(value);

export function useHomepageEditor() {
  const draft = ref<HomepageDraftConfig>(createHomepageDraft());
  const categories = ref<readonly AdminCategoryView[]>([]);
  const products = ref<readonly AdminProductSummaryView[]>([]);
  const version = ref(1);
  const publishedVersion = ref<number | undefined>();
  const publishedAt = ref<string | undefined>();
  const issues = ref<AdminHomepageView['draftIssues']>([]);
  const loading = ref(false);
  const saving = ref(false);
  const publishing = ref(false);
  const dirty = ref(false);
  const conflict = ref<string | null>(null);
  const lastError = ref<string | null>(null);

  const canPublish = computed(
    () => !dirty.value && !saving.value && !publishing.value,
  );

  function applyView(view: AdminHomepageView): void {
    draft.value = clone(view.draftConfig);
    version.value = view.version;
    publishedVersion.value = view.publishedVersion;
    publishedAt.value = view.publishedAt;
    issues.value = [...view.draftIssues];
    dirty.value = false;
    conflict.value = null;
  }

  async function load(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      const [view, loadedCategories, loadedProducts] = await Promise.all([
        homepageApi.get(),
        loadAllCategories(),
        loadAllProducts(),
      ]);
      categories.value = loadedCategories.filter(({ isActive }) => isActive);
      const activeCategoryIds = new Set(categories.value.map(({ id }) => id));
      products.value = loadedProducts.filter(
        ({ isActive, categoryId }) =>
          isActive && activeCategoryIds.has(categoryId),
      );
      applyView(view);
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : '首页配置加载失败';
      throw error;
    } finally {
      loading.value = false;
    }
  }

  function replaceDraft(value: HomepageDraftConfig): void {
    draft.value = clone(value);
    dirty.value = true;
    conflict.value = null;
  }

  async function saveDraft(): Promise<void> {
    saving.value = true;
    lastError.value = null;
    try {
      applyView(
        await homepageApi.saveDraft({
          config: clone(draft.value),
          version: version.value,
        }),
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        conflict.value = error.message;
      }
      lastError.value = error instanceof Error ? error.message : '草稿保存失败';
      throw error;
    } finally {
      saving.value = false;
    }
  }

  async function publish(): Promise<void> {
    if (dirty.value) throw new Error('请先保存草稿再发布');
    publishing.value = true;
    lastError.value = null;
    try {
      applyView(await homepageApi.publish({ version: version.value }));
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.status === 409) conflict.value = error.message;
        const nextIssues = error.details?.issues;
        if (Array.isArray(nextIssues)) {
          issues.value = nextIssues as AdminHomepageView['draftIssues'];
        }
      }
      lastError.value = error instanceof Error ? error.message : '首页发布失败';
      throw error;
    } finally {
      publishing.value = false;
    }
  }

  return {
    draft,
    categories,
    products,
    version,
    publishedVersion,
    publishedAt,
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
