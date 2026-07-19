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
  it('applies the 44px touch-target contract to both stepper buttons', () => {
    const wrapper = mount(CartItemCard, {
      props: { item, invalidLabel: '已失效' },
    });

    expect(wrapper.get('.cart-row__stepper').classes()).toContain(
      'cart-row__stepper--touch-target',
    );
    expect(wrapper.find('.van-stepper__minus').exists()).toBe(true);
    expect(wrapper.find('.van-stepper__plus').exists()).toBe(true);
  });
});
