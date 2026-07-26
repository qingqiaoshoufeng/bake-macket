import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { CartItemView } from '@bake-mall/contracts';

import CartItemCard from './CartItemCard.vue';

const item: CartItemView = {
  id: 'cart-1',
  quantity: 2,
  available: true,
  sku: {
    id: 'sku-1',
    name: '6寸',
    attributes: {},
    priceCents: 6800,
    stock: 10,
    imageUrl: null,
    isActive: true,
  },
  product: {
    id: 'product-1',
    name: '草莓蛋糕',
    coverImageUrl: null,
    isActive: true,
  },
};

describe('CartItemCard', () => {
  it('renders a selectable card with a polished quantity control', async () => {
    const wrapper = mount(CartItemCard, {
      props: { item, invalidLabel: '已失效', selected: true },
    });

    const checkbox = wrapper.get('[data-testid="cart-item-select"]');
    expect((checkbox.element as HTMLInputElement).checked).toBe(true);
    await checkbox.setValue(false);
    expect(wrapper.emitted('select')).toEqual([['cart-1', false]]);

    expect(wrapper.get('.cart-row__stepper').classes()).toContain(
      'cart-row__stepper--polished',
    );
    expect(wrapper.find('.van-stepper__minus').exists()).toBe(true);
    expect(wrapper.find('.van-stepper__plus').exists()).toBe(true);
    expect(wrapper.find('.van-stepper__input').exists()).toBe(true);
  });

  it('disables selection and quantity changes for invalid items', () => {
    const wrapper = mount(CartItemCard, {
      props: {
        item: { ...item, available: false },
        invalidLabel: '已失效',
        selected: false,
      },
    });

    expect(
      (
        wrapper.get('[data-testid="cart-item-select"]')
          .element as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(wrapper.get('.cart-row').classes()).toContain('is-invalid');
  });
});
