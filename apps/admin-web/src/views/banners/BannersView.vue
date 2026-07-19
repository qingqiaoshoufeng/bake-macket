<script setup lang="ts">
import type { AdminBannerView, MediaAsset } from '@bake-mall/contracts';
import { onMounted } from 'vue';
import { ElAlert, ElButton, ElMessage, ElMessageBox } from 'element-plus';

import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import BannerFormDialog from './components/BannerFormDialog.vue';
import BannerTable from './components/BannerTable.vue';
import { useBanners } from './hooks/useBanners.js';

const state = useBanners();
onMounted(state.refresh);

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
  <AdminPage>
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

    <ElAlert
      v-if="state.lastError.value"
      type="error"
      :title="state.lastError.value"
      :closable="false"
      show-icon
    >
      <template #default>
        <ElButton size="small" @click="state.refresh">重新加载</ElButton>
      </template>
    </ElAlert>

    <AdminDataPanel>
      <BannerTable
        :banners="state.banners.value"
        :loading="state.loading.value"
        :get-target-label="state.getTargetLabel"
        @edit="state.startEdit"
        @toggle="toggleBanner"
        @remove="removeBanner"
      />
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
