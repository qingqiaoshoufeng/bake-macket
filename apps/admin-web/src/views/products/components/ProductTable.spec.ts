/* eslint-disable vue/one-component-per-file -- local Element Plus stubs */
import { mount } from '@vue/test-utils';
import { defineComponent, provide } from 'vue';
import { describe, expect, it } from 'vitest';

import { PRODUCT_LIST_MOCK } from '../mock/list.mock.js';
import ProductTable from './ProductTable.vue';

const TableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, required: true } },
  setup(props) {
    provide('tableRows', props.data);
  },
  template:
    '<div :data-product-ids="data.map((product) => product.id).join(\',\')"><slot /></div>',
});
const TableColumnStub = defineComponent({
  name: 'ElTableColumn',
  inject: ['tableRows'],
  props: { label: { type: String, required: true } },
  template: `
    <section :data-column-label="label">
      <slot v-for="row in tableRows" :key="row.id" :row="row" />
    </section>
  `,
});
const ButtonStub = defineComponent({
  name: 'ElButton',
  template: '<button><slot /></button>',
});
const ImageStub = defineComponent({
  name: 'ElImage',
  props: { src: { type: String, required: true } },
  template: '<img :src="src" />',
});
const TagStub = defineComponent({
  name: 'ElTag',
  props: { type: { type: String, required: true } },
  template: '<span :data-tag-type="type"><slot /></span>',
});

function mountTable() {
  return mount(ProductTable, {
    props: { products: PRODUCT_LIST_MOCK, loading: false, deletingId: null },
    global: {
      stubs: {
        ElTable: TableStub,
        ElTableColumn: TableColumnStub,
        ElButton: ButtonStub,
        ElImage: ImageStub,
        ElTag: TagStub,
      },
    },
  });
}

describe('ProductTable', () => {
  it('passes the supplied products to the table and renders the configured columns', () => {
    const wrapper = mountTable();

    expect(
      wrapper.get('[data-product-ids]').attributes('data-product-ids'),
    ).toBe('product-1,product-2');
    expect(
      wrapper
        .findAll('[data-column-label]')
        .map((node) => node.attributes('data-column-label')),
    ).toEqual([
      '名称',
      '分类',
      '主图',
      '启用 SKU 数',
      '排序',
      '上架状态',
      '操作',
    ]);
    expect(
      wrapper.findAll('img').map((image) => image.attributes('src')),
    ).toEqual(
      PRODUCT_LIST_MOCK.map((product) => product.coverImage?.publicUrl),
    );
  });

  it('renders each product status from its own row data', () => {
    const wrapper = mountTable();

    expect(
      wrapper
        .findAll('[data-tag-type]')
        .map((tag) => [tag.text(), tag.attributes('data-tag-type')]),
    ).toEqual([
      ['上架', 'success'],
      ['下架', 'info'],
    ]);
  });

  it('emits product ids for editing and removal', async () => {
    const wrapper = mountTable();
    const [product] = PRODUCT_LIST_MOCK;

    await wrapper
      .get(`[data-testid="edit-product-${product.id}"]`)
      .trigger('click');
    await wrapper
      .get(`[data-testid="remove-product-${product.id}"]`)
      .trigger('click');

    expect(wrapper.emitted('edit')?.[0]).toEqual([product.id]);
    expect(wrapper.emitted('remove')?.[0]).toEqual([product.id]);
  });
});
