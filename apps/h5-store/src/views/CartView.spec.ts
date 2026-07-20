import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { customerApi } from '../api/customer.js';
import CartView from './CartView.vue';

const vantMocks = vi.hoisted(() => ({
  showConfirmDialog: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('vant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vant')>();
  return { ...actual, ...vantMocks };
});

const items = [
  {
    id: 'cart-1',
    quantity: 2,
    available: true,
    sku: {
      id: 'sku-1',
      name: '6寸',
      attributes: {},
      priceCents: 6800,
      stock: 3,
      imageUrl: null,
      isActive: true,
    },
    product: {
      id: 'product-1',
      name: '草莓云朵蛋糕',
      coverImageUrl: null,
      isActive: true,
    },
  },
  {
    id: 'cart-2',
    quantity: 1,
    available: false,
    sku: {
      id: 'sku-2',
      name: '已下架',
      attributes: {},
      priceCents: 3200,
      stock: 0,
      imageUrl: null,
      isActive: false,
    },
    product: {
      id: 'product-2',
      name: '昨日限定',
      coverImageUrl: null,
      isActive: false,
    },
  },
];

async function mountCart() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/cart', component: CartView },
      { path: '/checkout', component: { template: '<div />' } },
      { path: '/', component: { template: '<div />' } },
    ],
  });
  await router.push('/cart');
  await router.isReady();
  return mount(CartView, { global: { plugins: [pinia, router] } });
}

describe('CartView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vantMocks.showConfirmDialog.mockReset();
    vantMocks.showToast.mockReset();
    vi.spyOn(customerApi, 'listCart').mockResolvedValue(items);
  });

  it('shows live totals while marking unavailable rows as invalid', async () => {
    const wrapper = await mountCart();
    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    expect(wrapper.find('.store-page--with-fixed-action').exists()).toBe(true);
    expect(wrapper.get('[data-testid="checkout"]').classes()).toContain(
      'store-primary-action',
    );
    expect(wrapper.text()).toContain('已失效');
    expect(wrapper.text()).toContain('¥136.00');
    expect(
      wrapper.get('[data-testid="checkout"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('updates totals and checkout availability from item and all-selection controls', async () => {
    const wrapper = await mountCart();
    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    const itemSelect = wrapper.get('[data-testid="cart-item-select"]');
    await itemSelect.setValue(false);

    expect(wrapper.text()).toContain('¥0.00');
    expect(
      wrapper.get('[data-testid="checkout"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.get('[data-testid="select-all"]').text()).toContain('全选');

    await wrapper.get('[data-testid="select-all-input"]').setValue(true);

    expect(wrapper.text()).toContain('¥136.00');
    expect(
      wrapper.get('[data-testid="checkout"]').attributes('disabled'),
    ).toBeUndefined();
  });

  it('silently keeps the item when the remove confirmation is cancelled', async () => {
    vantMocks.showConfirmDialog.mockRejectedValueOnce(new Error('cancel'));
    const removeSpy = vi.spyOn(customerApi, 'removeCartItem');
    const wrapper = await mountCart();
    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    await wrapper.get('.cart-row__actions > button').trigger('click');
    await vi.waitFor(() =>
      expect(vantMocks.showConfirmDialog).toHaveBeenCalledOnce(),
    );

    expect(removeSpy).not.toHaveBeenCalled();
    expect(vantMocks.showToast).not.toHaveBeenCalled();
  });

  it('shows an explicit toast when the confirmed remove API call fails', async () => {
    vantMocks.showConfirmDialog.mockResolvedValueOnce(undefined);
    vi.spyOn(customerApi, 'removeCartItem').mockRejectedValueOnce(
      new Error('network'),
    );
    const wrapper = await mountCart();
    await vi.waitFor(() => expect(wrapper.text()).toContain('草莓云朵蛋糕'));

    await wrapper.get('.cart-row__actions > button').trigger('click');
    await vi.waitFor(() =>
      expect(vantMocks.showToast).toHaveBeenCalledWith('移除失败，请稍后重试'),
    );
  });
});
