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
  let operationGeneration = 0;
  let contentRevision = 0;
  let loadGeneration = 0;
  let pendingSaveCount = 0;
  let pendingPublishCount = 0;

  const canPublish = computed(
    () =>
      Boolean(draftId.value) &&
      !loading.value &&
      !dirty.value &&
      !saving.value &&
      !publishing.value,
  );

  function applyServerMetadata(view: AdminHomepageView): void {
    name.value = view.name;
    status.value = view.status;
    version.value = view.version;
    publishedVersion.value = view.publishedVersion;
    publishedAt.value = view.publishedAt;
    updatedAt.value = view.updatedAt ?? view.draftUpdatedAt;
    createdAt.value = view.createdAt;
    issues.value = [...view.draftIssues];
    conflict.value = null;
  }

  function applyView(view: AdminHomepageView): void {
    draftId.value = view.id;
    draft.value = clone(view.draftConfig);
    dirty.value = false;
    applyServerMetadata(view);
  }

  function reconcileMetadata(view: AdminHomepageView): void {
    if (view.id !== draftId.value) return;
    applyServerMetadata(view);
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

  function nextOperationGeneration(): number {
    const token = operationGeneration + 1;
    operationGeneration = token;
    return token;
  }

  function beginLoad(): number {
    const token = nextOperationGeneration();
    loadGeneration = token;
    loading.value = true;
    lastError.value = null;
    return token;
  }

  function isCurrentLoad(token: number, capturedRevision: number): boolean {
    return (
      token === loadGeneration &&
      token === operationGeneration &&
      capturedRevision === contentRevision
    );
  }

  function beginSave(): number {
    const token = nextOperationGeneration();
    pendingSaveCount += 1;
    saving.value = true;
    lastError.value = null;
    return token;
  }

  function finishSave(): void {
    pendingSaveCount = Math.max(0, pendingSaveCount - 1);
    saving.value = pendingSaveCount > 0;
  }

  function beginPublish(): number {
    const token = nextOperationGeneration();
    pendingPublishCount += 1;
    publishing.value = true;
    lastError.value = null;
    return token;
  }

  function finishPublish(): void {
    pendingPublishCount = Math.max(0, pendingPublishCount - 1);
    publishing.value = pendingPublishCount > 0;
  }

  function isCurrentMutation(token: number, capturedDraftId: string): boolean {
    return token === operationGeneration && capturedDraftId === draftId.value;
  }

  function applyMutationSuccess(
    view: AdminHomepageView,
    token: number,
    capturedDraftId: string,
    capturedRevision: number,
  ): void {
    if (!isCurrentMutation(token, capturedDraftId)) return;
    if (capturedRevision === contentRevision) {
      applyView(view);
      return;
    }
    applyServerMetadata(view);
  }

  async function load(id?: string): Promise<void> {
    const nextId = id ?? draftId.value;
    if (!nextId) throw new Error('请先选择首页草稿');
    const capturedRevision = contentRevision;
    const token = beginLoad();
    try {
      const [view] = await Promise.all([
        homepageApi.getOne(nextId),
        ensureCatalog(),
      ]);
      if (isCurrentLoad(token, capturedRevision)) applyView(view);
    } catch (error) {
      if (!isCurrentLoad(token, capturedRevision)) return;
      lastError.value = errorMessage(error, '首页配置加载失败');
      throw error;
    } finally {
      if (token === loadGeneration) loading.value = false;
    }
  }

  function replaceDraft(value: HomepageDraftConfig): void {
    contentRevision += 1;
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

  async function saveDraft(): Promise<AdminHomepageView | false> {
    if (!draftId.value || loading.value || saving.value || publishing.value)
      return false;
    const id = requireDraftId();
    const capturedRevision = contentRevision;
    const token = beginSave();
    try {
      const saved = await homepageApi.saveDraft(id, {
        config: clone(draft.value),
        version: version.value,
      });
      applyMutationSuccess(saved, token, id, capturedRevision);
      return saved;
    } catch (error) {
      if (!isCurrentMutation(token, id)) return false;
      applyApiError(error);
      lastError.value = errorMessage(error, '草稿保存失败');
      throw error;
    } finally {
      finishSave();
    }
  }

  async function publish(): Promise<boolean> {
    if (!draftId.value || loading.value || saving.value || publishing.value)
      return false;
    if (dirty.value) throw new Error('请先保存草稿再发布');
    const id = requireDraftId();
    const capturedRevision = contentRevision;
    const token = beginPublish();
    try {
      const published = await homepageApi.publish(id, {
        version: version.value,
      });
      applyMutationSuccess(published, token, id, capturedRevision);
      return true;
    } catch (error) {
      if (!isCurrentMutation(token, id)) return false;
      applyApiError(error);
      lastError.value = errorMessage(error, '首页发布失败');
      throw error;
    } finally {
      finishPublish();
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
    reconcileMetadata,
    saveDraft,
    publish,
  };
}
