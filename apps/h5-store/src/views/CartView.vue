<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';

import StoreStatePanel from '../components/feedback/StoreStatePanel.vue';
import StorePage from '../components/layout/StorePage.vue';
import StorePageHeader from '../components/layout/StorePageHeader.vue';
import { CartCheckoutBar, CartItemCard, useCart } from './cart/index.js';
import { CART_COPY } from './cart/config/copy.js';
import StoreTabbar from './catalog/components/StoreTabbar.vue';

const route = useRoute();
const router = useRouter();
const cart = useCart();

onMounted(async () => {
  try {
    await cart.methods.refresh();
  } catch {
    showToast(cart.error.value ?? '购物车加载失败');
  }
});

async function setQuantity(id: string, quantity: number): Promise<void> {
  try {
    await cart.methods.setQuantity(id, quantity);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '数量更新失败');
  }
}

async function remove(id: string): Promise<void> {
  try {
    await showConfirmDialog({
      title: '移除商品',
      message: '确定从购物车移除这份烘焙吗？',
    });
  } catch {
    return;
  }

  try {
    await cart.methods.remove(id);
  } catch {
    showToast('移除失败，请稍后重试');
  }
}

function navigate(path: string): void {
  void router.push(path);
}
</script>

<template>
  <StorePage with-tabbar with-fixed-action class="cart-view">
    <StorePageHeader
      :title="CART_COPY.title"
      eyebrow="READY TO BAKE"
      :description="`共 ${cart.data.itemCount.value} 件可结算商品`"
    />
    <StoreStatePanel
      v-if="cart.loading.value && !cart.data.items.value.length"
      state="loading"
      title="正在整理购物车"
      description="马上为你核对库存与数量。"
    />
    <StoreStatePanel
      v-else-if="!cart.data.items.value.length"
      state="empty"
      :title="CART_COPY.empty"
      description="去首页挑一份今天想吃的烘焙吧。"
      ><template #action
        ><button class="cart-view__browse" type="button" @click="navigate('/')">
          去首页挑选
        </button></template
      ></StoreStatePanel
    >
    <ul v-else class="cart-list">
      <CartItemCard
        v-for="item in cart.data.items.value"
        :key="item.id"
        :item="item"
        :invalid-label="CART_COPY.invalid"
        @quantity="setQuantity"
        @remove="remove"
      />
    </ul>
    <CartCheckoutBar
      :total-cents="cart.data.totalCents.value"
      :disabled="!cart.data.availableItems.value.length"
      :label="CART_COPY.checkout"
      @checkout="navigate('/checkout')"
    />
    <StoreTabbar :active-path="route.path" @navigate="navigate" />
  </StorePage>
</template>

<style scoped>
.cart-list {
  display: grid;
  gap: var(--mall-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.cart-view__browse {
  min-height: 44px;
  padding: 0 var(--mall-space-5);
  border: 0;
  border-radius: var(--mall-radius-card);
  background: var(--mall-primary);
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
</style>
