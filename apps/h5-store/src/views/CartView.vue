<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast, Stepper } from 'vant';

import StoreTabbar from './catalog/components/StoreTabbar.vue';
import { CART_COPY } from './cart/config/copy.js';
import { useCartSummary } from './cart/hooks/useCartSummary.js';

const router = useRouter();
const { cart, totalCents, itemCount } = useCartSummary();

onMounted(async () => {
  try {
    await cart.refresh();
  } catch {
    showToast(cart.lastError ?? '购物车加载失败');
  }
});

async function setQuantity(id: string, value: number | string): Promise<void> {
  try {
    await cart.setQuantity(id, Number(value));
  } catch (error) {
    showToast(error instanceof Error ? error.message : '数量更新失败');
  }
}

async function remove(id: string): Promise<void> {
  try {
    await showConfirmDialog({ title: '移除商品', message: '确定从购物车移除这份烘焙吗？' });
    await cart.remove(id);
  } catch {
    return;
  }
}
</script>

<template>
  <main class="cart-view">
    <header><small>READY TO BAKE</small><h1>{{ CART_COPY.title }}</h1><p>共 {{ itemCount }} 件可结算商品</p></header>
    <p v-if="cart.loading && !cart.items.length" class="state-copy">正在整理购物车…</p>
    <section v-else-if="!cart.items.length" class="empty-card">
      <span>🥐</span><p>{{ CART_COPY.empty }}</p><button type="button" @click="router.push('/')">去首页挑选</button>
    </section>
    <ul v-else class="cart-list">
      <li v-for="item in cart.items" :key="item.id" :class="['cart-row', !item.available && 'is-invalid']">
        <div class="cart-row__image">
          <img v-if="item.product.coverImageUrl" :src="item.product.coverImageUrl" :alt="item.product.name" />
          <span v-else>{{ item.product.name.slice(0, 1) || '烘' }}</span>
        </div>
        <div class="cart-row__body">
          <div class="cart-row__title"><h2>{{ item.product.name || '商品已下架' }}</h2><em v-if="!item.available">{{ CART_COPY.invalid }}</em></div>
          <p>{{ item.sku.name }}</p>
          <strong>¥{{ (item.sku.priceCents / 100).toFixed(2) }}</strong>
          <div class="cart-row__actions">
            <Stepper
              :model-value="item.quantity"
              :min="1"
              :max="99"
              :disabled="!item.available"
              @update:model-value="setQuantity(item.id, $event)"
            />
            <button type="button" @click="remove(item.id)">移除</button>
          </div>
        </div>
      </li>
    </ul>
    <footer class="checkout-bar">
      <div><small>商品合计</small><strong>¥{{ (totalCents / 100).toFixed(2) }}</strong></div>
      <button
        type="button"
        data-testid="checkout"
        :disabled="!cart.availableItems.length"
        @click="router.push('/checkout')"
      >{{ CART_COPY.checkout }}</button>
    </footer>
    <StoreTabbar />
  </main>
</template>

<style scoped>
.cart-view { width: min(100%, 560px); min-height: 100%; margin: 0 auto; padding: 24px 16px 176px; }
header small { color: #6b9270; letter-spacing: .16em; }
header h1 { margin: 6px 0 2px; font: 700 28px/1.2 Georgia, 'Songti SC', serif; }
header p { margin: 0 0 20px; color: var(--mall-muted); font-size: 13px; }
.cart-list { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none; }
.cart-row { display: grid; grid-template-columns: 88px 1fr; gap: 13px; padding: 12px; border-radius: 20px; background: #fff; box-shadow: 0 8px 24px rgba(73,62,49,.07); }
.cart-row.is-invalid { opacity: .62; filter: grayscale(.25); }
.cart-row__image { display: grid; place-items: center; min-height: 96px; overflow: hidden; border-radius: 14px; background: #edf2e9; color: #66806b; font: 700 24px Georgia, serif; }
.cart-row__image img { width: 100%; height: 100%; object-fit: cover; }
.cart-row__title { display: flex; align-items: start; justify-content: space-between; gap: 8px; }
h2 { margin: 1px 0 0; font-size: 15px; }
em { flex: 0 0 auto; border-radius: 999px; padding: 3px 7px; background: #eee5dd; color: #9a725c; font-size: 10px; font-style: normal; }
.cart-row__body > p { margin: 5px 0; color: var(--mall-muted); font-size: 12px; }
.cart-row__body > strong { color: #c87945; }
.cart-row__actions { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.cart-row__actions button { border: 0; background: transparent; color: #a67c69; }
.checkout-bar { position: fixed; left: 50%; bottom: 62px; z-index: 15; width: min(calc(100% - 24px), 536px); transform: translateX(-50%); display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 12px 18px; border-radius: 22px; background: #334b39; color: #fff; box-shadow: 0 14px 32px rgba(43,57,46,.25); }
.checkout-bar div { display: flex; flex-direction: column; }
.checkout-bar small { color: #cfe0d0; }
.checkout-bar strong { font-size: 20px; }
.checkout-bar button { min-width: 120px; height: 44px; border: 0; border-radius: 15px; background: #f2c99d; color: #4a3a2d; font-weight: 700; }
.checkout-bar button:disabled { opacity: .5; }
.empty-card { margin-top: 60px; padding: 38px 22px; border-radius: 28px; background: #fff; text-align: center; }
.empty-card span { font-size: 44px; }.empty-card p { color: var(--mall-muted); line-height: 1.6; }.empty-card button { border: 0; border-radius: 999px; padding: 11px 18px; background: #7da77d; color: #fff; }
.state-copy { padding: 80px 0; text-align: center; color: var(--mall-muted); }
</style>
