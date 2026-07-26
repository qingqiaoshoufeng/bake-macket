import type { CartRow } from '../type/index.js';

export const cartListMock: readonly CartRow[] = [
  {
    id: 'cart-demo',
    quantity: 1,
    available: true,
    sku: {
      id: 'sku-demo',
      name: '6寸',
      attributes: {},
      priceCents: 6800,
      stock: 6,
      imageUrl: null,
      isActive: true,
    },
    product: {
      id: 'product-demo',
      name: '草莓云朵蛋糕',
      coverImageUrl: null,
      isActive: true,
    },
  },
];
