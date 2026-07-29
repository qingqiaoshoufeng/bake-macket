<script setup lang="ts">
import { computed } from 'vue';

import type { AdminBannerView } from '@bake-mall/contracts';
import { ElButton, ElSwitch, ElTable, ElTableColumn } from 'element-plus';

import AdminEmptyState from '../../../components/feedback/AdminEmptyState.vue';
import { bannerColumns } from '../config/columns.js';

const props = defineProps<{
  banners: readonly AdminBannerView[];
  loading: boolean;
  getTargetLabel: (banner: AdminBannerView) => string;
  hasAppliedFilters?: boolean;
}>();

const emit = defineEmits<{
  edit: [banner: AdminBannerView];
  toggle: [banner: AdminBannerView];
  remove: [banner: AdminBannerView];
}>();

const tableData = computed(() => [...props.banners]);
</script>

<template>
  <div class="banner-table">
    <ElTable
      v-if="loading || props.banners.length > 0"
      v-loading="loading"
      :data="tableData"
      row-key="id"
      height="100%"
      class="admin-table banner-table__table"
    >
      <ElTableColumn
        :label="bannerColumns[0].label"
        :width="bannerColumns[0].width"
      >
        <template #default="{ row }">
          <div class="banner-ticket">
            <img
              v-if="row.image"
              :src="row.image.publicUrl"
              :alt="row.title ?? 'Banner 图片'"
            />
            <span v-else class="banner-ticket__legacy">需重新上传</span>
            <div>
              <strong>{{ row.title || '未命名 Banner' }}</strong>
              <small>{{
                row.image?.objectKey ?? '历史图片未纳入受管存储'
              }}</small>
            </div>
          </div>
        </template>
      </ElTableColumn>
      <ElTableColumn
        :label="bannerColumns[1].label"
        :min-width="bannerColumns[1].minWidth"
      >
        <template #default="{ row }">
          <span class="target-label">{{
            props.getTargetLabel(row as AdminBannerView)
          }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn
        prop="sortOrder"
        :label="bannerColumns[2].label"
        :width="bannerColumns[2].width"
      />
      <ElTableColumn
        :label="bannerColumns[3].label"
        :width="bannerColumns[3].width"
      >
        <template #default="{ row }">
          <ElSwitch
            :model-value="row.isActive"
            inline-prompt
            active-text="上架"
            inactive-text="下架"
            @change="emit('toggle', row as AdminBannerView)"
          />
        </template>
      </ElTableColumn>
      <template #empty>
        <AdminEmptyState
          title="暂无 Banner"
          description="先创建一张首页横幅，让顾客快速看到主推内容。"
          tone="lilac"
        />
      </template>

      <ElTableColumn
        :label="bannerColumns[4].label"
        :width="bannerColumns[4].width"
        fixed="right"
      >
        <template #default="{ row }">
          <ElButton
            link
            type="primary"
            @click="emit('edit', row as AdminBannerView)"
            >编辑</ElButton
          >
          <ElButton
            link
            type="danger"
            @click="emit('remove', row as AdminBannerView)"
            >删除</ElButton
          >
        </template>
      </ElTableColumn>
    </ElTable>
    <AdminEmptyState
      v-else
      :title="hasAppliedFilters ? '当前筛选无结果' : '暂无 Banner'"
      :description="
        hasAppliedFilters
          ? '请调整筛选条件后重新查询。'
          : '先创建一张首页横幅，让顾客快速看到主推内容。'
      "
      tone="lilac"
    />
  </div>
</template>

<style scoped>
.banner-table {
  height: 100%;
  min-height: 0;
}

.banner-table__table {
  height: 100%;
  min-height: 0;
}

.banner-ticket {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.banner-ticket img,
.banner-ticket__legacy {
  width: 92px;
  height: 52px;
  border-radius: 10px;
  object-fit: cover;
  box-shadow: 0 5px 14px rgb(84 61 119 / 15%);
}

.banner-ticket__legacy {
  display: grid;
  place-items: center;
  border: 1px dashed #d7cae8;
  background: #faf7ff;
  color: #927eab;
  font-size: 11px;
}

.banner-ticket div {
  min-width: 0;
}

.banner-ticket strong,
.banner-ticket small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.banner-ticket strong {
  color: #352e48;
  font-size: 14px;
}

.banner-ticket small {
  margin-top: 5px;
  color: #a49bb9;
  font-size: 11px;
}

.target-label {
  color: #625879;
}
</style>
