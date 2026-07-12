import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SkuTableEditor from './SkuTableEditor.vue';

/**
 * SkuTableEditor contract pinned by Task 12.
 *
 * - Adding a blank SKU row lets the merchant fill name, price (yuan) and
 *   stock. The editor converts the yuan price to integer cents via
 *   `Math.round(Number(yuan) * 100)` before emitting `update:modelValue`,
 *   and rejects any stock value below zero by showing a Chinese error
 *   message and withholding the emit.
 * - A single empty SKU row also emits `update:modelValue` once both fields
 *   pass validation so the parent can persist the variant.
 *
 * The contract deliberately keeps the editor UI-only: the parent view owns
 * the actual API call and decides whether to persist `isActive` / `enabled`
 * versus just `enabled`. Tests therefore cover the visible editor surface
 * (`name`, `price`, `stock`, `enabled` toggle) rather than the server-side
 * SKU model.
 */

type SkuInput = {
  id?: string;
  name: string;
  priceCents: number;
  stock: number;
  enabled: boolean;
  imageUrl?: string;
};

function mountEditor(initial: SkuInput[] = []): VueWrapper {
  return mount(SkuTableEditor, {
    props: { modelValue: initial },
  });
}

describe('SkuTableEditor', () => {
  it('converts yuan input to integer cents and blocks negative stock', async () => {
    const wrapper = mountEditor();
    await wrapper.get('[data-testid="add-sku"]').trigger('click');
    await wrapper.get('[data-testid="name-0"]').setValue('6寸');
    await wrapper.get('[data-testid="price-0"]').setValue('68.50');
    await wrapper.get('[data-testid="stock-0"]').setValue('-1');

    expect(wrapper.text()).toContain('库存不能小于 0');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('emits integer cents after fixing the stock value', async () => {
    const wrapper = mountEditor();
    await wrapper.get('[data-testid="add-sku"]').trigger('click');
    await wrapper.get('[data-testid="name-0"]').setValue('6寸');
    await wrapper.get('[data-testid="price-0"]').setValue('68.50');
    await wrapper.get('[data-testid="stock-0"]').setValue('-1');
    // Fix the bad stock value.
    await wrapper.get('[data-testid="stock-0"]').setValue('3');

    expect(wrapper.text()).not.toContain('库存不能小于 0');
    const emitted = wrapper.emitted('update:modelValue');
    expect(emitted).toBeDefined();
    const last = (emitted as unknown[][]).at(-1)?.[0] as SkuInput[];
    expect(last[0]).toMatchObject({
      name: '6寸',
      priceCents: 6850,
      stock: 3,
      enabled: true,
    });
  });

  it('rounds two-decimal yuan inputs to the nearest integer cent', async () => {
    const wrapper = mountEditor();
    await wrapper.get('[data-testid="add-sku"]').trigger('click');
    await wrapper.get('[data-testid="name-0"]').setValue('8寸');
    await wrapper.get('[data-testid="price-0"]').setValue('108.33');
    await wrapper.get('[data-testid="stock-0"]').setValue('5');

    const emitted = wrapper.emitted('update:modelValue');
    const last = (emitted as unknown[][]).at(-1)?.[0] as SkuInput[];
    expect(last[0].priceCents).toBe(10833);
  });
});