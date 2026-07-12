<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showConfirmDialog, showToast } from 'vant';

import AddressForm from '../components/AddressForm.vue';
import { useAddressesStore } from '../stores/addresses.js';
import type {
  AddressView,
  CreateAddressRequest,
  UpdateAddressRequest,
} from '../api/customer.js';

const addresses = useAddressesStore();
const editing = ref<AddressView | null>(null);
const creating = ref(false);

const items = computed<AddressView[]>(() => addresses.items);

onMounted(async () => {
  try {
    await addresses.refresh();
  } catch {
    showToast('地址加载失败');
  }
});

async function onSubmit(
  payload: CreateAddressRequest | UpdateAddressRequest,
): Promise<void> {
  try {
    if (editing.value) {
      await addresses.update(editing.value.id, payload as UpdateAddressRequest);
      showToast({ type: 'success', message: '地址已更新' });
    } else {
      await addresses.create(payload as CreateAddressRequest);
      showToast({ type: 'success', message: '地址已添加' });
    }
    editing.value = null;
    creating.value = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存失败';
    showToast(message);
  }
}

function startCreate(): void {
  editing.value = null;
  creating.value = true;
}

function startEdit(address: AddressView): void {
  creating.value = false;
  editing.value = address;
}

function cancelForm(): void {
  editing.value = null;
  creating.value = false;
}

async function toggleDefault(address: AddressView): Promise<void> {
  if (address.isDefault) return;
  try {
    await addresses.setDefault(address.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : '设置失败';
    showToast(message);
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
    await addresses.remove(address.id);
    showToast({ type: 'success', message: '地址已删除' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除失败';
    showToast(message);
  }
}
</script>

<template>
  <main class="addresses">
    <header class="addresses__hero">
      <h1>地址簿</h1>
      <p>配送订单前请确保至少保存一个收货地址。</p>
    </header>

    <button
      type="button"
      class="addresses__create"
      data-testid="new-address"
      @click="startCreate"
    >
      + 新增地址
    </button>

    <AddressForm
      v-if="creating"
      :saving="addresses.saving"
      @submit="onSubmit"
      @cancel="cancelForm"
    />

    <AddressForm
      v-if="editing"
      :initial="editing"
      :saving="addresses.saving"
      @submit="onSubmit"
      @cancel="cancelForm"
    />

    <p v-if="addresses.loading && !items.length" class="addresses__loading">
      正在加载…
    </p>
    <p v-else-if="!items.length" class="addresses__empty">
      暂无地址,请先添加。
    </p>

    <ul v-else class="addresses__list">
      <li
        v-for="address in items"
        :key="address.id"
        class="addresses__item"
        :data-testid="`address-${address.id}`"
      >
        <div class="addresses__item-head">
          <span class="addresses__item-name">
            {{ address.recipient }} · {{ address.phone }}
          </span>
          <span v-if="address.isDefault" class="addresses__item-badge">
            默认
          </span>
        </div>
        <p class="addresses__item-text">
          {{ address.province }} {{ address.city }} {{ address.district }}
          {{ address.detail }}
        </p>
        <div class="addresses__item-actions">
          <button
            type="button"
            class="addresses__item-action"
            :disabled="address.isDefault"
            :data-testid="`set-default-${address.id}`"
            @click="toggleDefault(address)"
          >
            {{ address.isDefault ? '已是默认' : '设为默认' }}
          </button>
          <button
            type="button"
            class="addresses__item-action"
            :data-testid="`edit-${address.id}`"
            @click="startEdit(address)"
          >
            编辑
          </button>
          <button
            type="button"
            class="addresses__item-action addresses__item-action--danger"
            :data-testid="`remove-${address.id}`"
            @click="removeAddress(address)"
          >
            删除
          </button>
        </div>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.addresses {
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--mall-ink);
}
.addresses__hero h1 {
  color: var(--mall-leaf);
  margin: 0 0 4px;
  font-size: 20px;
}
.addresses__hero p {
  margin: 0;
  color: var(--mall-muted);
  font-size: 13px;
}
.addresses__create {
  height: 44px;
  border-radius: var(--van-radius-lg);
  border: 0;
  background: var(--van-primary-color);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.addresses__loading,
.addresses__empty {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 16px;
  color: var(--mall-muted);
  font-size: 14px;
  text-align: center;
  margin: 0;
}
.addresses__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.addresses__item {
  background: #fff;
  border-radius: var(--van-radius-lg);
  padding: 12px 16px;
  box-shadow: 0 1px 3px rgba(143, 181, 143, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.addresses__item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.addresses__item-name {
  font-size: 14px;
  color: var(--mall-ink);
  font-weight: 500;
}
.addresses__item-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 12px;
  background: rgba(143, 181, 143, 0.15);
  color: var(--mall-leaf);
  font-size: 11px;
}
.addresses__item-text {
  margin: 0;
  color: var(--mall-muted);
  font-size: 13px;
}
.addresses__item-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.addresses__item-action {
  background: transparent;
  border: 1px solid #e7e2d8;
  border-radius: var(--van-radius-md);
  padding: 4px 12px;
  font-size: 12px;
  color: var(--mall-ink);
  cursor: pointer;
}
.addresses__item-action:disabled {
  color: var(--mall-muted);
  cursor: not-allowed;
  background: #faf6ec;
}
.addresses__item-action--danger {
  color: #c14d4d;
  border-color: rgba(193, 77, 77, 0.3);
}
</style>
