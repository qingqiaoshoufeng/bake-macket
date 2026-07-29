<script setup lang="ts">
import { onMounted } from 'vue';
import {
  ElAlert,
  ElButton,
  ElMessage,
  ElMessageBox,
  ElPagination,
} from 'element-plus';
import { useRouter } from 'vue-router';

import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import AdminPageHeader from '../../components/layout/AdminPageHeader.vue';
import ProductFilters from './components/ProductFilters.vue';
import ProductTable from './components/ProductTable.vue';
import { PRODUCT_PAGINATION } from './config/pagination.js';
import { useProductsList } from './hooks/useProductsList.js';
import type { ProductFilterForm } from './type/list.js';

const router = useRouter();
const state = useProductsList();

onMounted(state.initialize);

function updateFilters(patch: Partial<ProductFilterForm>): void {
  Object.assign(state.draftFilters, patch);
}

async function searchProducts(): Promise<void> {
  try {
    await state.search();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '筛选条件无效');
  }
}

function createProduct(): void {
  void router.push('/products/new');
}

function editProduct(id: string): void {
  void router.push(`/products/${id}/edit`);
}

async function removeProduct(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '确定删除该商品吗？此操作不可撤销。',
      '删除商品',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    );
  } catch (error: unknown) {
    if (error === 'cancel' || error === 'close') {
      return;
    }

    ElMessage.error('删除确认失败，请重试');
    return;
  }

  try {
    await state.remove(id);
    ElMessage.success('商品已删除');
  } catch {
    ElMessage.error('删除商品失败，请重试');
  }
}
</script>

<template>
  <AdminPage workspace>
    <template #header>
      <AdminPageHeader
        eyebrow="CATALOG"
        title="商品管理"
        description="管理商品信息、SKU 库存与上架状态。"
      >
        <template #actions>
          <ElButton
            type="primary"
            :data-testid="'create-product'"
            @click="createProduct"
          >
            新增商品
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
          <ElButton
            size="small"
            :data-testid="'retry-products'"
            @click="state.initialize"
          >
            重试
          </ElButton>
        </template>
      </ElAlert>
    </template>

    <AdminDataPanel fill>
      <template #toolbar>
        <ProductFilters
          :filters="state.draftFilters"
          :categories="state.categories.value"
          :loading="state.loading.value"
          :advanced-count="state.advancedCount.value"
          @change="updateFilters"
          @search="searchProducts"
          @reset="state.reset"
        />
      </template>

      <ProductTable
        :products="state.products.value"
        :loading="state.loading.value"
        :deleting-id="state.deletingId.value"
        :has-applied-filters="state.hasAppliedFilters.value"
        @edit="editProduct"
        @remove="removeProduct"
      />

      <template v-if="state.total.value > 0" #footer>
        <ElPagination
          background
          layout="total, sizes, prev, pager, next"
          :total="state.total.value"
          :current-page="state.page.value"
          :page-size="state.pageSize.value"
          :page-sizes="[...PRODUCT_PAGINATION.pageSizes]"
          @update:current-page="state.setPage"
          @update:page-size="state.setPageSize"
        />
      </template>
    </AdminDataPanel>
  </AdminPage>
</template>
