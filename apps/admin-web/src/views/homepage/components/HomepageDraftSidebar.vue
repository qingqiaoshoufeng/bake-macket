<script setup lang="ts">
import {
  HomepageDraftStatus,
  type AdminHomepageDraftSummary,
} from '@bake-mall/contracts';
import { ElButton, ElPagination, ElTag } from 'element-plus';

withDefaults(
  defineProps<{
    readonly items: readonly AdminHomepageDraftSummary[];
    readonly activeId: string | null;
    readonly loading: boolean;
    readonly page?: number;
    readonly pageSize?: number;
    readonly total?: number;
  }>(),
  { page: 1, pageSize: 20, total: 0 },
);

const emit = defineEmits<{
  select: [id: string];
  create: [];
  edit: [item: AdminHomepageDraftSummary];
  apply: [item: AdminHomepageDraftSummary];
  rename: [item: AdminHomepageDraftSummary];
  remove: [item: AdminHomepageDraftSummary];
  'page-change': [page: number];
}>();

const statusLabels: Readonly<Record<HomepageDraftStatus, string>> = {
  [HomepageDraftStatus.PUBLISHED]: '线上版本',
  [HomepageDraftStatus.PUBLISHED_WITH_CHANGES]: '线上来源·有未发布修改',
  [HomepageDraftStatus.DRAFT]: '普通草稿',
};

function isPublishedSource(item: AdminHomepageDraftSummary): boolean {
  return (
    item.status === HomepageDraftStatus.PUBLISHED ||
    item.status === HomepageDraftStatus.PUBLISHED_WITH_CHANGES
  );
}

function tagType(status: HomepageDraftStatus): 'success' | 'warning' | 'info' {
  if (status === HomepageDraftStatus.PUBLISHED) return 'success';
  if (status === HomepageDraftStatus.PUBLISHED_WITH_CHANGES) return 'warning';
  return 'info';
}

function formatUpdatedAt(value: string): string {
  return value.replace('T', ' ').slice(0, 16);
}
</script>

<template>
  <aside class="homepage-draft-sidebar" aria-label="首页草稿列表">
    <header class="homepage-draft-sidebar__header">
      <div>
        <span class="homepage-draft-sidebar__eyebrow">工作版本</span>
        <strong>首页草稿</strong>
      </div>
      <ElButton
        type="primary"
        size="small"
        data-action="create"
        @click="emit('create')"
      >
        新建
      </ElButton>
    </header>

    <div v-if="loading" class="homepage-draft-sidebar__state">
      正在加载草稿…
    </div>
    <div v-else-if="items.length === 0" class="homepage-draft-sidebar__state">
      <span>还没有草稿</span>
      <ElButton size="small" data-action="create" @click="emit('create')">
        创建第一个草稿
      </ElButton>
    </div>
    <div v-else class="homepage-draft-sidebar__list">
      <article
        v-for="item in items"
        :key="item.id"
        class="homepage-draft-sidebar__item"
        :class="{
          'homepage-draft-sidebar__item--active': item.id === activeId,
        }"
        :data-draft-id="item.id"
        tabindex="0"
        @click="emit('select', item.id)"
        @keydown.enter="emit('select', item.id)"
      >
        <div class="homepage-draft-sidebar__item-heading">
          <strong>{{ item.name }}</strong>
          <ElTag :type="tagType(item.status)" size="small" effect="light">
            {{ statusLabels[item.status] }}
          </ElTag>
        </div>
        <span class="homepage-draft-sidebar__updated-at">
          更新于 {{ formatUpdatedAt(item.updatedAt) }}
        </span>
        <div class="homepage-draft-sidebar__actions">
          <ElButton
            link
            size="small"
            data-action="edit"
            @click.stop="emit('edit', item)"
          >
            编辑
          </ElButton>
          <ElButton
            link
            size="small"
            type="primary"
            data-action="apply"
            :disabled="item.status === HomepageDraftStatus.PUBLISHED"
            @click.stop="emit('apply', item)"
          >
            {{
              item.status === HomepageDraftStatus.PUBLISHED ? '使用中' : '应用'
            }}
          </ElButton>
          <ElButton
            link
            size="small"
            data-action="rename"
            @click.stop="emit('rename', item)"
          >
            重命名
          </ElButton>
          <ElButton
            link
            size="small"
            type="danger"
            data-action="remove"
            :disabled="isPublishedSource(item)"
            :title="
              isPublishedSource(item) ? '线上来源草稿不能删除' : '删除草稿'
            "
            @click.stop="emit('remove', item)"
          >
            删除
          </ElButton>
        </div>
      </article>
    </div>

    <ElPagination
      v-if="total > pageSize"
      class="homepage-draft-sidebar__pagination"
      size="small"
      layout="prev, pager, next"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="emit('page-change', $event)"
    />
  </aside>
</template>

<style scoped>
.homepage-draft-sidebar {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-card);
  background: rgb(255 255 255 / 88%);
  box-shadow: var(--admin-shadow-card);
  overflow: hidden;
}

.homepage-draft-sidebar__header,
.homepage-draft-sidebar__item-heading,
.homepage-draft-sidebar__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.homepage-draft-sidebar__header > div {
  display: grid;
  gap: 2px;
}

.homepage-draft-sidebar__eyebrow,
.homepage-draft-sidebar__updated-at {
  color: var(--admin-muted);
  font-size: 11px;
}

.homepage-draft-sidebar__eyebrow {
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.homepage-draft-sidebar__list {
  display: grid;
  align-content: start;
  gap: 9px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.homepage-draft-sidebar__item {
  display: grid;
  gap: 9px;
  padding: 11px;
  border: 1px solid transparent;
  border-radius: 13px;
  background: color-mix(in srgb, var(--admin-lavender) 14%, white);
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;
}

.homepage-draft-sidebar__item:hover,
.homepage-draft-sidebar__item:focus-visible {
  border-color: color-mix(in srgb, var(--admin-mint) 55%, transparent);
  outline: none;
  transform: translateY(-1px);
}

.homepage-draft-sidebar__item--active {
  border-color: var(--admin-mint);
  background: color-mix(in srgb, var(--admin-mint) 14%, white);
}

.homepage-draft-sidebar__item-heading {
  align-items: flex-start;
  flex-direction: column;
}

.homepage-draft-sidebar__item-heading strong {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.homepage-draft-sidebar__actions {
  justify-content: flex-end;
}

.homepage-draft-sidebar__state {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  color: var(--admin-muted);
  text-align: center;
}

.homepage-draft-sidebar__pagination {
  justify-content: center;
}
</style>
