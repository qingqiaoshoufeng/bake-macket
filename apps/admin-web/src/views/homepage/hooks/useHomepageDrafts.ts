import {
  HomepageDraftStatus,
  type AdminHomepageDraftSummary,
  type AdminHomepageView,
  type AdminPageQuery,
  type CreateHomepageDraftRequest,
  type PublishHomepageRequest,
} from '@bake-mall/contracts';
import { ref } from 'vue';

import { homepageApi } from '../api/index.js';
import type { HomepageDraftCreateForm } from '../type/form.js';

const DEFAULT_QUERY: AdminPageQuery = { page: 1, pageSize: 20 };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isPublishedSource(item: AdminHomepageDraftSummary): boolean {
  return (
    item.status === HomepageDraftStatus.PUBLISHED ||
    item.status === HomepageDraftStatus.PUBLISHED_WITH_CHANGES
  );
}

function preferredActiveId(
  items: readonly AdminHomepageDraftSummary[],
): string | null {
  return items.find(isPublishedSource)?.id ?? items[0]?.id ?? null;
}

function toSummary(view: AdminHomepageView): AdminHomepageDraftSummary {
  const now = new Date().toISOString();
  return {
    id: view.id,
    name: view.name ?? `草稿 ${view.id}`,
    status: view.status ?? HomepageDraftStatus.DRAFT,
    version: view.version,
    ...(view.updatedByAdminId
      ? { updatedByAdminId: view.updatedByAdminId }
      : {}),
    updatedAt: view.updatedAt ?? view.draftUpdatedAt ?? now,
    createdAt: view.createdAt ?? view.updatedAt ?? view.draftUpdatedAt ?? now,
  };
}

function applySummary(
  items: readonly AdminHomepageDraftSummary[],
  view: AdminHomepageView,
): readonly AdminHomepageDraftSummary[] {
  const next = toSummary(view);
  return items.some(({ id }) => id === next.id)
    ? items.map((item) => (item.id === next.id ? next : item))
    : [next, ...items];
}

function createRequest(
  form: HomepageDraftCreateForm,
  activeId: string | null,
): CreateHomepageDraftRequest {
  if (form.mode === 'BLANK') return { name: form.name, mode: 'BLANK' };
  if (!activeId) throw new Error('请先选择要复制的草稿');
  return { name: form.name, mode: 'COPY', sourceDraftId: activeId };
}

export function useHomepageDrafts() {
  const items = ref<readonly AdminHomepageDraftSummary[]>([]);
  const page = ref(DEFAULT_QUERY.page);
  const pageSize = ref(DEFAULT_QUERY.pageSize);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const activeId = ref<string | null>(null);
  const publishedDraftId = ref<string | null>(null);
  let requestSequence = 0;

  async function refresh(query?: AdminPageQuery): Promise<void> {
    const nextQuery = query ?? { page: page.value, pageSize: pageSize.value };
    const sequence = requestSequence + 1;
    requestSequence = sequence;
    loading.value = true;
    error.value = null;
    try {
      const result = await homepageApi.list(nextQuery);
      if (sequence !== requestSequence) return;
      items.value = [...result.items];
      page.value = result.page;
      pageSize.value = result.pageSize;
      total.value = result.total;
      publishedDraftId.value = result.publishedDraftId ?? null;
      const activeExists = items.value.some(({ id }) => id === activeId.value);
      if (!activeExists) activeId.value = preferredActiveId(items.value);
    } catch (cause) {
      if (sequence === requestSequence) {
        error.value = errorMessage(cause, '首页草稿加载失败');
      }
    } finally {
      if (sequence === requestSequence) loading.value = false;
    }
  }

  function select(id: string): void {
    activeId.value = id;
  }

  async function create(
    form: HomepageDraftCreateForm,
  ): Promise<AdminHomepageView> {
    error.value = null;
    try {
      const created = await homepageApi.create(
        createRequest(form, activeId.value),
      );
      items.value = applySummary(items.value, created);
      total.value += 1;
      activeId.value = created.id;
      return created;
    } catch (cause) {
      error.value = errorMessage(cause, '首页草稿创建失败');
      throw cause;
    }
  }

  async function rename(id: string, name: string): Promise<AdminHomepageView> {
    const item = items.value.find((candidate) => candidate.id === id);
    if (!item) throw new Error('未找到要重命名的草稿');
    error.value = null;
    try {
      const renamed = await homepageApi.rename(id, {
        name,
        version: item.version,
      });
      items.value = applySummary(items.value, renamed);
      return renamed;
    } catch (cause) {
      error.value = errorMessage(cause, '首页草稿重命名失败');
      throw cause;
    }
  }

  async function remove(id: string): Promise<void> {
    const index = items.value.findIndex((item) => item.id === id);
    const item = items.value[index];
    if (!item) throw new Error('未找到要删除的草稿');
    if (id === publishedDraftId.value || isPublishedSource(item)) {
      throw new Error('当前线上来源草稿不能删除');
    }
    error.value = null;
    try {
      await homepageApi.remove(id);
      const nextActiveId =
        items.value[index + 1]?.id ?? items.value[index - 1]?.id ?? null;
      items.value = items.value.filter((candidate) => candidate.id !== id);
      total.value = Math.max(0, total.value - 1);
      if (activeId.value === id) activeId.value = nextActiveId;
    } catch (cause) {
      error.value = errorMessage(cause, '首页草稿删除失败');
      throw cause;
    }
  }

  async function publish(
    id: string,
    body: PublishHomepageRequest,
  ): Promise<AdminHomepageView> {
    error.value = null;
    try {
      const published = await homepageApi.publish(id, body);
      const publishedSummary = toSummary(published);
      items.value = items.value.map((item) => {
        if (item.id === id) return publishedSummary;
        return isPublishedSource(item)
          ? { ...item, status: HomepageDraftStatus.DRAFT }
          : item;
      });
      publishedDraftId.value = id;
      return published;
    } catch (cause) {
      error.value = errorMessage(cause, '首页草稿发布失败');
      throw cause;
    }
  }

  return {
    items,
    page,
    pageSize,
    total,
    loading,
    error,
    activeId,
    publishedDraftId,
    refresh,
    select,
    create,
    rename,
    remove,
    publish,
  };
}
