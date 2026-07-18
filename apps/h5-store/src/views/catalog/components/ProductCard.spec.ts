import { mount } from '@vue/test-utils';
import type { PublicProductSummaryView } from '@bake-mall/contracts';
import { describe, expect, it } from 'vitest';

import ProductCard from './ProductCard.vue';

const product: PublicProductSummaryView = {
  id: 'product-1',
  categoryId: 'cake',
  name: '草莓云朵蛋糕',
  skus: [
    {
      id: 'sku-live',
      name: '6寸',
      attributes: {},
      priceCents: 6800,
      stock: 3,
      isAvailable: true,
    },
    {
      id: 'sku-zero',
      name: '8寸',
      attributes: {},
      priceCents: 5800,
      stock: 0,
      isAvailable: true,
    },
    {
      id: 'sku-disabled',
      name: '4寸',
      attributes: {},
      priceCents: 4800,
      stock: 2,
      isAvailable: false,
    },
  ],
};

describe('ProductCard', () => {
  it('shows the lowest price among available in-stock SKUs', () => {
    const wrapper = mount(ProductCard, { props: { product } });

    expect(wrapper.text()).toContain('¥68.00 起');
    expect(wrapper.text()).not.toContain('¥58.00 起');
    expect(wrapper.text()).not.toContain('¥48.00 起');
  });

  it('uses a safe fallback when no SKU can be sold', () => {
    const wrapper = mount(ProductCard, {
      props: {
        product: {
          ...product,
          skus: product.skus.map((sku) => ({ ...sku, stock: 0 })),
        },
      },
    });

    expect(wrapper.text()).toContain('到店了解');
    expect(wrapper.text()).not.toContain('¥0.00');
  });
});
