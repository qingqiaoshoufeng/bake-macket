import type { MediaAsset } from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it } from 'vitest';

import type { ProductImageFormRow } from '../type/form.js';
import ProductImagesEditor from './ProductImagesEditor.vue';

const UploaderStub = defineComponent({
  name: 'CosImageUploader',
  props: {
    modelValue: { type: Object, default: null },
    scope: { type: String, required: true },
  },
  emits: ['update:modelValue', 'uploading-change'],
  template: '<div class="uploader-stub" />',
});

const firstAsset: MediaAsset = {
  objectKey: 'products/first.webp',
  publicUrl: 'https://cdn.example.com/products/first.webp',
};
const secondAsset: MediaAsset = {
  objectKey: 'products/second.webp',
  publicUrl: 'https://cdn.example.com/products/second.webp',
};

function mountEditor(modelValue: readonly ProductImageFormRow[] = []) {
  return mount(ProductImagesEditor, {
    props: { modelValue },
    global: { stubs: { CosImageUploader: UploaderStub } },
  });
}

describe('ProductImagesEditor', () => {
  it('adds assets with stable local ids and continuous sort orders immutably', async () => {
    const initial = Object.freeze([]) as readonly ProductImageFormRow[];
    const wrapper = mountEditor(initial);
    const pendingUploader = wrapper.findAllComponents(UploaderStub).at(-1);
    pendingUploader?.vm.$emit('update:modelValue', firstAsset);
    await wrapper.vm.$nextTick();

    const firstEmit = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as
      ProductImageFormRow[] | undefined;
    expect(firstEmit).toEqual([
      expect.objectContaining({ ...firstAsset, sortOrder: 0 }),
    ]);
    expect(firstEmit?.[0]?.localId).toMatch(/^product-image-\d+$/);
    expect(initial).toEqual([]);

    await wrapper.setProps({ modelValue: firstEmit });
    wrapper
      .findAllComponents(UploaderStub)
      .at(-1)
      ?.vm.$emit('update:modelValue', secondAsset);
    await wrapper.vm.$nextTick();
    const secondEmit = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as
      ProductImageFormRow[] | undefined;
    expect(secondEmit?.map(({ sortOrder }) => sortOrder)).toEqual([0, 1]);
    expect(new Set(secondEmit?.map(({ localId }) => localId))).toHaveLength(2);
  });

  it('preserves existing ids and renumbers without mutating the input', async () => {
    const initial = Object.freeze([
      Object.freeze({
        localId: 'product-image-existing',
        id: 'image-1',
        ...firstAsset,
        sortOrder: 0,
      }),
      Object.freeze({
        localId: 'product-image-second',
        id: 'image-2',
        ...secondAsset,
        sortOrder: 1,
      }),
    ]);
    const snapshot = structuredClone(initial);
    const wrapper = mountEditor(initial);

    await wrapper.get('[data-testid="remove-image-0"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([
      {
        localId: 'product-image-second',
        id: 'image-2',
        ...secondAsset,
        sortOrder: 0,
      },
    ]);
    expect(initial).toEqual(snapshot);
  });

  it('aggregates uploads by localId and converges after deleting an uploading row', async () => {
    const initial: readonly ProductImageFormRow[] = [
      {
        localId: 'product-image-existing',
        id: 'image-1',
        ...firstAsset,
        sortOrder: 0,
      },
    ];
    const wrapper = mountEditor(initial);
    const rowUploader = wrapper.findAllComponents(UploaderStub)[0];

    rowUploader?.vm.$emit('uploading-change', true);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('uploading-change')?.at(-1)?.[0]).toBe(true);

    await wrapper.get('[data-testid="remove-image-0"]').trigger('click');
    expect(wrapper.emitted('uploading-change')?.at(-1)?.[0]).toBe(false);
  });
});
