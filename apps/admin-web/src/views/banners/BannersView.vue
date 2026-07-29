<script setup lang="ts">
import type { AdminBannerView, MediaAsset } from '@bake-mall/contracts';
import { onMounted } from 'vue';
import {
  ElAlert,
  ElButton,
  ElMessage,
  ElMessageBox,
  ElPagination,
} from 'element-plus';

import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import BannerFilters from './components/BannerFilters.vue';
import BannerFormDialog from './components/BannerFormDialog.vue';
import BannerTable from './components/BannerTable.vue';
import { BANNER_PAGINATION } from './config/pagination.js';
import { useBanners } from './hooks/useBanners.js';
import type { BannerFilterForm } from './type/list.js';

const state = useBanners();
onMounted(state.initialize);

function updateFilters(patch: Partial<BannerFilterForm>): void {
  Object.assign(state.draftFilters, patch);
}

function updateForm(value: Partial<typeof state.form>): void {
  Object.assign(state.form, value);
}

function updateImage(image: MediaAsset | null): void {
  updateForm({ image });
}

async function saveBanner(): Promise<void> {
  try {
    await state.save();
    ElMessage.success(
      state.editingId.value ? 'Banner 已更新' : 'Banner 已创建',
    );
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'Banner 保存失败');
  }
}

async function toggleBanner(banner: AdminBannerView): Promise<void> {
  try {
    await state.toggleActive(banner);
    ElMessage.success(banner.isActive ? 'Banner 已下架' : 'Banner 已上架');
  } catch {
    ElMessage.error('状态更新失败，请重试');
  }
}

async function removeBanner(banner: AdminBannerView): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除“${banner.title || '未命名 Banner'}”吗？`,
      '删除 Banner',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
    await state.remove(banner.id);
    ElMessage.success('Banner 已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error('Banner 删除失败，请重试');
    }
  }
}
</script>

<template>
  <AdminPage workspace>
    <template #header>
      <AdminPageHeader
        eyebrow="HOMEPAGE"
        title="Banner 管理"
        description="控制首页横幅的图片、顺序、展示状态与跳转目标。"
      >
        <template #actions>
          <ElButton type="primary" @click="state.openCreate">
            新增 Banner
          </ElButton>
        </template>
      </AdminPageHeader>
    </template>

    <template v-if="state.lastError.value" #alert>
      <ElAlert
        type="error"
        :title="state.lastError.value"
        :closable="false"
        show-icon
      >
        <template #default>
          <ElButton size="small" @click="state.initialize">重新加载</ElButton>
        </template>
      </ElAlert>
    </template>

    <AdminDataPanel fill>
      <template #toolbar>
        <BannerFilters
          :filters="state.draftFilters"
          :target-options="state.filterTargetOptions.value"
          :loading="state.loading.value"
          :advanced-count="state.advancedCount.value"
          @change="updateFilters"
          @target-type-change="state.setFilterTargetType"
          @search="state.search"
          @reset="state.reset"
        />
      </template>

      <BannerTable
        :banners="state.banners.value"
        :loading="state.loading.value"
        :get-target-label="state.getTargetLabel"
        :has-applied-filters="state.hasAppliedFilters.value"
        @edit="state.startEdit"
        @toggle="toggleBanner"
        @remove="removeBanner"
      />

      <template v-if="state.total.value > 0" #footer>
        <ElPagination
          background
          layout="total, sizes, prev, pager, next"
          :total="state.total.value"
          :current-page="state.page.value"
          :page-size="state.pageSize.value"
          :page-sizes="[...BANNER_PAGINATION.pageSizes]"
          @update:current-page="state.setPage"
          @update:page-size="state.setPageSize"
        />
      </template>
    </AdminDataPanel>

    <BannerFormDialog
      :visible="state.dialogVisible.value"
      :editing="Boolean(state.editingId.value)"
      :form="state.form"
      :target-options="state.targetOptions.value"
      :saving="state.saving.value"
      :uploading="state.uploading.value"
      @close="state.closeDialog"
      @save="saveBanner"
      @target-type-change="state.setTargetType"
      @form-change="updateForm"
      @image-change="updateImage"
      @uploading-change="state.setUploading"
    />
  </AdminPage>
</template>
