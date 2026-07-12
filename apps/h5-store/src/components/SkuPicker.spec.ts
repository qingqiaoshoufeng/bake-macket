import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SkuPicker from './SkuPicker.vue';

import type { SkuView } from '@bake-mall/contracts';

/**
 * SkuPicker behaviour pinned by Task 9:
 *
 * - Pressing the add-cart button with a chosen SKU that is either disabled
 *   (`isAvailable === false`) or out of stock (`stock <= 0`) MUST NOT emit
 *   `add`. The picker stays in the "nothing selected" state until the user
 *   explicitly picks a sellable SKU.
 * - Pressing add after picking an enabled, in-stock SKU emits exactly one
 *   `add` event carrying `{ skuId, quantity }`. The picker reads
 *   `quantity` from the inline stepper (default 1).
 * - When the user types a quantity outside `[1, 99]` into the stepper the
 *   picker clamps on blur so the emit always uses a valid cart quantity.
 */

const sellableSku: SkuView = {
  id: 'sku-1',
  name: '6寸',
  attributes: { size: '6寸' },
  priceCents: 6800,
  stock: 3,
  isAvailable: true,
};

const outOfStockSku: SkuView = {
  id: 'sku-empty',
  name: '8寸',
  attributes: { size: '8寸' },
  priceCents: 8800,
  stock: 0,
  isAvailable: true,
};

const disabledSku: SkuView = {
  id: 'sku-disabled',
  name: '10寸',
  attributes: { size: '10寸' },
  priceCents: 10800,
  stock: 5,
  isAvailable: false,
};

describe('SkuPicker', () => {
  it('does not emit add when the chosen SKU is disabled or empty', async () => {
    const wrapper = mount(SkuPicker, {
      props: { skus: [outOfStockSku, disabledSku] },
    });

    // Selecting an out-of-stock SKU keeps the add button disabled.
    await wrapper.get('[data-testid="sku-sku-empty"]').trigger('click');
    expect(
      (wrapper.get('[data-testid="add-cart"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await wrapper.get('[data-testid="add-cart"]').trigger('click');
    expect(wrapper.emitted('add')).toBeUndefined();

    // Selecting a disabled SKU also keeps the add button disabled.
    await wrapper.get('[data-testid="sku-sku-disabled"]').trigger('click');
    expect(
      (wrapper.get('[data-testid="add-cart"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await wrapper.get('[data-testid="add-cart"]').trigger('click');
    expect(wrapper.emitted('add')).toBeUndefined();
  });

  it('emits { skuId, quantity } when the chosen SKU is available and in stock', async () => {
    const wrapper = mount(SkuPicker, {
      props: { skus: [sellableSku, outOfStockSku] },
    });

    await wrapper.get('[data-testid="sku-sku-1"]').trigger('click');
    expect(
      (wrapper.get('[data-testid="add-cart"]').element as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    await wrapper.get('[data-testid="add-cart"]').trigger('click');

    const events = wrapper.emitted('add');
    expect(events).toHaveLength(1);
    expect(events?.[0]).toEqual([{ skuId: 'sku-1', quantity: 1 }]);
  });

  it('emits the picked quantity from the inline stepper', async () => {
    const wrapper = mount(SkuPicker, {
      props: { skus: [sellableSku] },
    });

    await wrapper.get('[data-testid="sku-sku-1"]').trigger('click');
    const stepper = wrapper.get('[data-testid="qty"]');
    await stepper.setValue('3');

    await wrapper.get('[data-testid="add-cart"]').trigger('click');

    const events = wrapper.emitted('add');
    expect(events?.[0]).toEqual([{ skuId: 'sku-1', quantity: 3 }]);
  });
});
