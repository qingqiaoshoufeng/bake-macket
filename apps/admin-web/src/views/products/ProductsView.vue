<script setup lang="ts">
import { onMounted } from 'vue';
import { ElAlert, ElButton, ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';

import ProductTable from './components/ProductTable.vue';
import { useProductsList } from './hooks/useProductsList.js';

const router = useRouter();
const { products, loading, deletingId, lastError, refresh, remove } =
  useProductsList();

onMounted(refresh);

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
    await remove(id);
    ElMessage.success('商品已删除');
  } catch {
    ElMessage.error('删除商品失败，请重试');
  }
}
</script>

<template>
  <section class="products">
    <header class="products__head">
      <div>
        <h1>商品管理</h1>
        <p>管理商品、SKU 和上架状态。</p>
      </div>
      <ElButton
        type="primary"
        :data-testid="'create-product'"
        @click="createProduct"
      >
        新增商品
      </ElButton>
    </header>

    <ElAlert
      v-if="lastError"
      type="error"
      :title="lastError"
      :closable="false"
      show-icon
    >
      <template #default>
        <ElButton size="small" :data-testid="'retry-products'" @click="refresh">
          重试
        </ElButton>
      </template>
    </ElAlert>

    <ProductTable
      :products="products"
      :loading="loading"
      :deleting-id="deletingId"
      @edit="editProduct"
      @remove="removeProduct"
    />
  </section>
</template>

<style scoped>
.products {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.products__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.products__head h1 {
  margin: 0;
  color: #2f2a3d;
  font-size: 22px;
}

.products__head p {
  margin: 4px 0 0;
  color: #8a83a3;
  font-size: 13px;
}
</style>
