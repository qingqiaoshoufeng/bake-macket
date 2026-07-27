<script setup lang="ts">
import { onMounted } from 'vue';
import { showConfirmDialog, showToast } from 'vant';

import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import StorePage from '../components/layout/StorePage.vue';
import StorePageHeader from '../components/layout/StorePageHeader.vue';
import {
  AddressCard,
  AddressForm,
  useAddresses,
  type AddressView,
} from './addresses/index.js';

const addresses = useAddresses();

onMounted(async () => {
  try {
    await addresses.methods.refresh();
  } catch {
    showToast('地址加载失败');
  }
});

async function submit(): Promise<void> {
  try {
    const result = await addresses.methods.submit();
    if (result === 'invalid') {
      showToast('请检查表单填写');
      return;
    }
    showToast({
      type: 'success',
      message: result === 'updated' ? '地址已更新' : '地址已添加',
    });
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败');
  }
}

async function toggleDefault(address: AddressView): Promise<void> {
  if (address.isDefault) return;
  try {
    await addresses.methods.setDefault(address.id);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '设置失败');
  }
}

async function removeAddress(address: AddressView): Promise<void> {
  try {
    await showConfirmDialog({
      title: '删除地址',
      message: `确认删除 ${address.recipient} 的地址吗?`,
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await addresses.methods.remove(address.id);
    showToast({ type: 'success', message: '地址已删除' });
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败');
  }
}
</script>

<template>
  <StorePage class="addresses">
    <StorePageHeader
      title="地址簿"
      eyebrow="DELIVERY NOTES"
      description="配送订单前请确保至少保存一个收货地址。"
      ><template #actions
        ><button
          type="button"
          class="addresses__create"
          data-testid="new-address"
          @click="addresses.methods.startCreate"
        >
          + 新增
        </button></template
      ></StorePageHeader
    >
    <AddressForm
      v-if="addresses.data.formOpen.value"
      :values="addresses.data.values.value"
      :errors="addresses.data.errors.value"
      :editing="Boolean(addresses.data.editing.value)"
      :saving="addresses.saving.value"
      @update="addresses.methods.updateValues"
      @submit="submit"
      @cancel="addresses.methods.cancel"
    />
    <StoreStatePanel
      v-if="addresses.loading.value && !addresses.data.items.value.length"
      state="loading"
      title="正在加载地址"
      description="马上为你整理好地址簿。"
    />
    <StoreStatePanel
      v-else-if="!addresses.data.items.value.length"
      state="empty"
      title="暂无地址,请先添加。"
      description="保存地址后即可用于同城配送订单。"
    />
    <ul v-else class="addresses__list">
      <AddressCard
        v-for="address in addresses.data.items.value"
        :key="address.id"
        :address="address"
        @default="toggleDefault"
        @edit="addresses.methods.startEdit"
        @remove="removeAddress"
      />
    </ul>
  </StorePage>
</template>

<style scoped>
.addresses__create {
  min-width: 72px;
  min-height: 44px;
  padding: 0 var(--mall-space-3);
  border: 0;
  border-radius: var(--mall-radius-control);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.addresses :deep(.address-form) {
  margin-bottom: var(--mall-space-3);
}
.addresses__list {
  display: grid;
  gap: var(--mall-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
