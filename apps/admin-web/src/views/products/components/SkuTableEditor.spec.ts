import type { SkuFormRow } from '../type/form.js';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import SkuTableEditor from './SkuTableEditor.vue';

const row: SkuFormRow = {
  rowId: 'sku-row-1',
  id: 'sku-1',
  stockVersion: 3,
  name: '6寸',
  attributes: [{ key: 'size', value: '6寸' }],
  priceYuan: '68.50',
  stock: 0,
  isActive: true,
  image: null,
};

describe('SkuTableEditor', () => {
  it('is presentational, displays attributes/image controls, and uses inactive semantics', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const wrapper = mount(SkuTableEditor, {
      props: { modelValue: [row] },
    });

    expect(wrapper.find('[data-testid="attribute-key-0-0"]').exists()).toBe(
      true,
    );
    expect(wrapper.findComponent({ name: 'CosImageUploader' }).exists()).toBe(
      true,
    );
    expect(wrapper.get('[data-testid="sku-table-scroll"]').classes()).toContain(
      'admin-horizontal-scroll',
    );
    expect(wrapper.get('[data-testid="name-0"]').classes()).toContain(
      'sku-editor__input--name',
    );
    expect(wrapper.text()).toContain('下架');

    await wrapper.get('[data-testid="remove-0"]').trigger('click');
    expect(fetchSpy).not.toHaveBeenCalled();
    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as
      SkuFormRow[] | undefined;
    expect(emitted?.[0]).toMatchObject({
      id: 'sku-1',
      stockVersion: 3,
      isActive: false,
    });
  });

  it('emits the new empty SKU row without modifying existing props', async () => {
    const modelValue = [row];
    const wrapper = mount(SkuTableEditor, { props: { modelValue } });

    await wrapper.get('[data-testid="add-sku"]').trigger('click');

    expect(modelValue).toEqual([row]);
    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as
      SkuFormRow[] | undefined;
    expect(emitted).toHaveLength(2);
    expect(emitted?.[0]).toEqual(row);
    expect(emitted?.[1]?.id).toBeUndefined();
    expect(emitted?.[1]).toMatchObject({
      name: '',
      attributes: [],
      priceYuan: '0.00',
      stock: 0,
      isActive: true,
      image: null,
    });
  });

  it('forwards per-row upload state to support save gating', async () => {
    const wrapper = mount(SkuTableEditor, {
      props: { modelValue: [row] },
    });
    wrapper
      .findComponent({ name: 'CosImageUploader' })
      .vm.$emit('uploading-change', true);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('uploading-change')?.at(-1)?.[0]).toBe(true);
  });

  it('keeps an existing SKU upload gated while soft-deactivating the row', async () => {
    const wrapper = mount(SkuTableEditor, {
      props: { modelValue: [row] },
    });
    const uploader = wrapper.findComponent({ name: 'CosImageUploader' });
    uploader.vm.$emit('uploading-change', true);
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-testid="remove-0"]').trigger('click');

    expect(wrapper.emitted('uploading-change')?.at(-1)?.[0]).toBe(true);
    expect(
      (wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SkuFormRow[])[0],
    ).toMatchObject({ id: 'sku-1', isActive: false });

    uploader.vm.$emit('uploading-change', false);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('uploading-change')?.at(-1)?.[0]).toBe(false);
  });

  it('emits invalid visible drafts instead of silently retaining old SKU values', async () => {
    const wrapper = mount(SkuTableEditor, { props: { modelValue: [row] } });

    await wrapper.get('[data-testid="price-0"]').setValue('68.501');
    await wrapper.get('[data-testid="price-0"]').trigger('change');

    expect(
      (wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SkuFormRow[])[0]
        ?.priceYuan,
    ).toBe('68.501');
  });
});
