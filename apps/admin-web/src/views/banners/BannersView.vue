<script setup lang="ts">
import type { AdminBannerView, MediaAsset } from '@bake-mall/contracts';
import { onMounted } from 'vue';
import { ElAlert, ElButton, ElMessage, ElMessageBox } from 'element-plus';

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
  <section class="banners-page">
    <header class="banners-page__head">
      <div>
        <span class="banners-page__eyebrow">首页橱窗</span>
        <h1>Banner 管理</h1>
        <p>控制首页横幅的图片、顺序、展示状态与跳转目标。</p>
      </div>
      <ElButton type="primary" size="large" @click="state.openCreate">
        新增 Banner
      </ElButton>
    </header>

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

    <BannerTable
      :banners="state.banners.value"
      :loading="state.loading.value"
      :get-target-label="state.getTargetLabel"
      @edit="state.startEdit"
      @toggle="toggleBanner"
      @remove="removeBanner"
    />

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
  </section>
</template>

<style scoped>
.banners-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.banners-page__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 24px;
  overflow: hidden;
  border: 1px solid #e9e0f8;
  border-radius: 20px;
  background:
    radial-gradient(circle at 92% 15%, rgb(255 221 231 / 72%), transparent 24%),
    linear-gradient(118deg, #fff 0%, #faf7ff 62%, #f5edff 100%);
}

.banners-page__eyebrow {
  color: #9a76c6;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.banners-page h1 {
  margin: 6px 0 0;
  color: #332b45;
  font-size: 24px;
  letter-spacing: -0.02em;
}

.banners-page p {
  margin: 7px 0 0;
  color: #817692;
  font-size: 13px;
}

@media (max-width: 640px) {
  .banners-page__head {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
