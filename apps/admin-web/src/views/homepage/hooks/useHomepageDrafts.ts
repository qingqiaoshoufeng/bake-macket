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

type LoadOptions = {
  readonly throwOnError?: boolean;
};

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
  let stateGeneration = 0;

  function nextGeneration(): number {
    const generation = stateGeneration + 1;
    stateGeneration = generation;
    return generation;
  }

  function isCurrent(generation: number): boolean {
    return generation === stateGeneration;
  }

  async function load(
    query: AdminPageQuery = DEFAULT_QUERY,
    preferredId?: string,
    options: LoadOptions = {},
  ): Promise<boolean> {
    const generation = nextGeneration();
    const loadStartActiveId = activeId.value;
    loading.value = true;
    error.value = null;
    try {
      const result = await homepageApi.list(query);
      if (!isCurrent(generation)) return false;
      items.value = [...result.items];
      page.value = result.page;
      pageSize.value = result.pageSize;
      total.value = result.total;
      publishedDraftId.value = result.publishedDraftId ?? null;
      const activeExists = items.value.some(({ id }) => id === activeId.value);
      const activeChangedDuringLoad = activeId.value !== loadStartActiveId;
      if (activeChangedDuringLoad && activeExists) return true;
      const preferredExists = items.value.some(({ id }) => id === preferredId);
      if (preferredId !== undefined) {
        activeId.value = preferredExists
          ? preferredId
          : preferredActiveId(items.value);
      } else if (!activeExists) activeId.value = preferredActiveId(items.value);
      return true;
    } catch (cause) {
      if (!isCurrent(generation)) return false;
      error.value = errorMessage(cause, '首页草稿加载失败');
      if (options.throwOnError) throw cause;
      return true;
    } finally {
      if (isCurrent(generation)) loading.value = false;
    }
  }

  async function refresh(query?: AdminPageQuery): Promise<void> {
    await load(query ?? { page: page.value, pageSize: pageSize.value });
  }

  function beginMutation(): void {
    nextGeneration();
    error.value = null;
  }

  function select(id: string): void {
    activeId.value = id;
  }

  function reconcileDetail(view: AdminHomepageView): void {
    items.value = applySummary(items.value, view);
  }

  function operationPreferredId(
    operationStartActiveId: string | null,
  ): string | undefined {
    return activeId.value === operationStartActiveId
      ? (operationStartActiveId ?? undefined)
      : (activeId.value ?? undefined);
  }

  async function convergeAfterFailure(
    cause: unknown,
    fallback: string,
    query: AdminPageQuery,
    preferredId?: string,
  ): Promise<never> {
    const refreshIsCurrent = await load(query, preferredId);
    if (refreshIsCurrent) error.value = errorMessage(cause, fallback);
    throw cause;
  }

  async function create(
    form: HomepageDraftCreateForm,
  ): Promise<AdminHomepageView> {
    const sourceId = activeId.value;
    beginMutation();
    let created: AdminHomepageView;
    try {
      created = await homepageApi.create(createRequest(form, sourceId));
    } catch (cause) {
      return convergeAfterFailure(
        cause,
        '首页草稿创建失败',
        { page: page.value, pageSize: pageSize.value },
        activeId.value ?? undefined,
      );
    }
    items.value = applySummary(items.value, created);
    total.value += 1;
    page.value = DEFAULT_QUERY.page;
    activeId.value = created.id;
    await load(
      { page: DEFAULT_QUERY.page, pageSize: pageSize.value },
      created.id,
    );
    return created;
  }

  async function rename(id: string, name: string): Promise<AdminHomepageView> {
    const item = items.value.find((candidate) => candidate.id === id);
    if (!item) throw new Error('未找到要重命名的草稿');
    const operationStartActiveId = activeId.value;
    const operationQuery = { page: page.value, pageSize: pageSize.value };
    beginMutation();
    let renamed: AdminHomepageView;
    try {
      renamed = await homepageApi.rename(id, {
        name,
        version: item.version,
      });
    } catch (cause) {
      return convergeAfterFailure(
        cause,
        '首页草稿重命名失败',
        operationQuery,
        activeId.value ?? undefined,
      );
    }
    items.value = applySummary(items.value, renamed);
    const renamedCurrentDraft =
      operationStartActiveId === id && activeId.value === id;
    await load(
      {
        page: renamedCurrentDraft ? DEFAULT_QUERY.page : page.value,
        pageSize: pageSize.value,
      },
      renamedCurrentDraft ? id : (activeId.value ?? undefined),
    );
    return renamed;
  }

  async function remove(id: string): Promise<void> {
    const index = items.value.findIndex((item) => item.id === id);
    const item = items.value[index];
    if (!item) throw new Error('未找到要删除的草稿');
    if (id === publishedDraftId.value || isPublishedSource(item)) {
      throw new Error('当前线上来源草稿不能删除');
    }
    const operationStartActiveId = activeId.value;
    const operationQuery = { page: page.value, pageSize: pageSize.value };
    beginMutation();
    try {
      await homepageApi.remove(id);
    } catch (cause) {
      return convergeAfterFailure(
        cause,
        '首页草稿删除失败',
        operationQuery,
        activeId.value ?? undefined,
      );
    }
    const nextActiveId =
      items.value[index + 1]?.id ?? items.value[index - 1]?.id ?? null;
    const nextItems = items.value.filter((candidate) => candidate.id !== id);
    const nextTotal = Math.max(0, total.value - 1);
    const lastPage = Math.max(1, Math.ceil(nextTotal / pageSize.value));
    const targetPage = Math.min(page.value, lastPage);
    const selectedDuringOperation =
      activeId.value === operationStartActiveId
        ? operationStartActiveId
        : activeId.value;
    const preferredId =
      selectedDuringOperation === id
        ? nextActiveId
        : (selectedDuringOperation ?? nextActiveId);
    items.value = nextItems;
    total.value = nextTotal;
    page.value = targetPage;
    activeId.value = nextItems.some(
      ({ id: candidateId }) => candidateId === preferredId,
    )
      ? preferredId
      : (nextItems[0]?.id ?? null);
    await load(
      { page: targetPage, pageSize: pageSize.value },
      activeId.value ?? undefined,
    );
  }

  async function publish(
    id: string,
    body: PublishHomepageRequest,
  ): Promise<AdminHomepageView> {
    const operationStartActiveId = activeId.value;
    const operationQuery = { page: page.value, pageSize: pageSize.value };
    beginMutation();
    let published: AdminHomepageView;
    try {
      published = await homepageApi.publish(id, body);
    } catch (cause) {
      return convergeAfterFailure(
        cause,
        '首页草稿发布失败',
        operationQuery,
        activeId.value ?? undefined,
      );
    }
    const publishedSummary = toSummary(published);
    items.value = items.value.map((item) => {
      if (item.id === id) return publishedSummary;
      return isPublishedSource(item)
        ? { ...item, status: HomepageDraftStatus.DRAFT }
        : item;
    });
    publishedDraftId.value = id;
    await load(
      { page: page.value, pageSize: pageSize.value },
      operationPreferredId(operationStartActiveId),
    );
    return published;
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
    load,
    refresh,
    select,
    reconcileDetail,
    create,
    rename,
    remove,
    publish,
  };
}
