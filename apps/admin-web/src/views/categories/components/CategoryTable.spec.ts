import { readFileSync } from 'node:fs';

import { mount, type VueWrapper } from '@vue/test-utils';
import { ElTable, ElTableColumn } from 'element-plus';
import { defineComponent, h, type VNode } from 'vue';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CATEGORY_COLUMNS } from '../config/columns.js';
import { ACTIVE_LABEL, INACTIVE_LABEL } from '../config/defaults.js';
import { categoryListMock } from '../mock/list.mock.js';
import CategoryTable from './CategoryTable.vue';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function readClassStyle(className: string): CSSStyleDeclaration {
  const source = readFileSync(
    `${process.cwd()}/src/views/categories/components/CategoryTable.vue`,
    'utf8',
  );
  const declarations = source.match(
    new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`),
  )?.[1];
  const style = document.createElement('div').style;

  expect(declarations, `缺少 .${className} 样式规则`).toBeDefined();
  style.cssText = declarations ?? '';
  return style;
}

// Scoped-slot adapters only: real Element Plus components remain mounted for contract assertions.
// eslint-disable-next-line vue/one-component-per-file
const ActionTableAdapter = defineComponent({
  name: 'ElTable',
  props: {
    data: {
      type: Array,
      default: () => [],
    },
  },
  setup(props, { slots }) {
    return () =>
      h(
        'div',
        slots.default?.().flatMap((column) =>
          (props.data as (typeof categoryListMock)[number][]).map((row) =>
            (
              column.children as {
                default?: (scope: {
                  row: (typeof categoryListMock)[number];
                }) => VNode[];
              }
            ).default?.({ row }),
          ),
        ),
      );
  },
});

// eslint-disable-next-line vue/one-component-per-file
const ActionColumnAdapter = defineComponent({
  name: 'ElTableColumn',
  setup() {
    return () => null;
  },
});

function mountTable(useActionAdapters = false): VueWrapper {
  return mount(CategoryTable, {
    props: {
      categories: categoryListMock,
      loading: false,
      editingId: null,
      draft: {
        name: '',
        imageUrl: '',
        sortOrder: 0,
        isActive: true,
      },
    },
    global: {
      directives: {
        loading: {},
      },
      stubs: useActionAdapters
        ? {
            ElTable: ActionTableAdapter,
            ElTableColumn: ActionColumnAdapter,
          }
        : undefined,
    },
  });
}

describe('CategoryTable', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('uses stable row identity and every configured column', () => {
    const wrapper = mountTable();
    const table = wrapper.findComponent({ name: ElTable.name });
    const columnProps = wrapper
      .findAllComponents({ name: ElTableColumn.name })
      .map((column) => column.props());

    expect(table.props('rowKey')).toBe('id');
    const tableStyle = readClassStyle('category-table');

    expect(table.props('height')).toBe('100%');
    expect(tableStyle.height).toBe('100%');
    expect(tableStyle.minHeight).toBe('0');
    expect(tableStyle.minWidth).toBe('');
    expect(table.classes()).toContain('admin-table');
    expect(table.props('data')).toEqual(categoryListMock);
    expect(table.props('data')).not.toBe(categoryListMock);
    expect(columnProps).toHaveLength(CATEGORY_COLUMNS.length);
    expect(columnProps.map(({ label }) => label)).toEqual(
      CATEGORY_COLUMNS.map(({ label }) => label),
    );
    expect(columnProps.at(-1)?.fixed).toBe('right');
  });

  it('shows active and inactive labels from the shared defaults', () => {
    const wrapper = mountTable(true);

    expect(wrapper.text()).toContain(ACTIVE_LABEL);
    expect(wrapper.text()).toContain(INACTIVE_LABEL);
  });

  it('disables the independent status switch while editing a row', async () => {
    const category = categoryListMock[0];
    const wrapper = mountTable(true);

    await wrapper.setProps({ editingId: category.id });

    expect(
      wrapper
        .findAllComponents({ name: 'ElSwitch' })
        .find((component) =>
          component.attributes('data-testid')?.endsWith(category.id),
        )
        ?.props('disabled'),
    ).toBe(true);
  });

  it('emits row actions without mutating the readonly category input', async () => {
    const original = structuredClone(categoryListMock);
    const category = categoryListMock[0];
    const wrapper = mountTable(true);

    await wrapper.get(`[data-testid="edit-${category.id}"]`).trigger('click');
    await wrapper
      .get(`[data-testid="category-active-${category.id}"]`)
      .trigger('click');
    await wrapper.get(`[data-testid="delete-${category.id}"]`).trigger('click');

    expect(wrapper.emitted('start-edit')?.[0]).toEqual([category]);
    expect(wrapper.emitted('toggle-active')?.[0]).toEqual([category]);
    expect(wrapper.emitted('remove')?.[0]).toEqual([category]);
    expect(categoryListMock).toEqual(original);
  });
});
