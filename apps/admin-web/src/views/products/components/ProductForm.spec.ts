import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it } from 'vitest';

import { createDefaultProductForm } from '../config/defaults.js';
import ProductForm from './ProductForm.vue';

const UploadStateStub = defineComponent({
  name: 'CosImageUploader',
  emits: ['uploading-change'],
  template: '<div data-testid="cover-uploader" />',
});

const productFormStubs = {
  CosImageUploader: UploadStateStub,
  ProductImagesEditor: { template: '<div data-testid="images-editor" />' },
  RichTextEditor: { template: '<div data-testid="rich-editor" />' },
  SkuTableEditor: { template: '<div data-testid="sku-editor" />' },
};

describe('ProductForm', () => {
  it('renders every product field and delegates media/SKU editing to child components', () => {
    const wrapper = mount(ProductForm, {
      props: {
        form: createDefaultProductForm(),
        categories: [],
        saving: false,
        uploading: false,
      },
      global: {
        stubs: productFormStubs,
      },
    });

    expect(wrapper.find('[data-testid="product-name"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="product-summary"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="product-category"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="product-sort-order"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="product-active"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cover-uploader"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="images-editor"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="rich-editor"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="sku-editor"]').exists()).toBe(true);
  });

  it('emits false after the last local upload completes even when the parent mirrors true', async () => {
    const wrapper = mount(ProductForm, {
      props: {
        form: createDefaultProductForm(),
        categories: [],
        saving: false,
        uploading: false,
      },
      global: { stubs: productFormStubs },
    });
    const uploader = wrapper.findComponent(UploadStateStub);

    uploader.vm.$emit('uploading-change', true);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('update:uploading')?.at(-1)?.[0]).toBe(true);

    await wrapper.setProps({ uploading: true });
    uploader.vm.$emit('uploading-change', false);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:uploading')?.at(-1)?.[0]).toBe(false);
  });

  it('emits an immutable replacement form rather than fetching data', async () => {
    const form = createDefaultProductForm();
    const wrapper = mount(ProductForm, {
      props: { form, categories: [], saving: false, uploading: false },
      global: { stubs: productFormStubs },
    });

    await wrapper.get('[data-testid="product-name"]').setValue('草莓蛋糕');

    expect(wrapper.emitted('update:form')?.[0]?.[0]).toEqual(
      expect.objectContaining({ name: '草莓蛋糕' }),
    );
    expect(form.name).toBe('');
  });

  it('preserves trailing spaces in controlled text drafts until submit mapping', async () => {
    const wrapper = mount(ProductForm, {
      props: {
        form: createDefaultProductForm(),
        categories: [],
        saving: false,
        uploading: false,
      },
      global: { stubs: productFormStubs },
    });

    await wrapper.get('[data-testid="product-name"]').setValue('Chocolate ');
    await wrapper.get('[data-testid="product-summary"]').setValue('Fresh ');

    expect(wrapper.emitted('update:form')?.at(-2)?.[0]).toEqual(
      expect.objectContaining({ name: 'Chocolate ' }),
    );
    expect(wrapper.emitted('update:form')?.at(-1)?.[0]).toEqual(
      expect.objectContaining({ summary: 'Fresh ' }),
    );
  });
});
