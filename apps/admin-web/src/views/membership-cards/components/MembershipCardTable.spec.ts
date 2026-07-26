/* eslint-disable vue/one-component-per-file -- local Element Plus stubs */
import {
  MembershipLevelStatus,
  MembershipTheme,
  type AdminMembershipLevelListItem,
} from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { defineComponent, provide } from 'vue';
import { describe, expect, it } from 'vitest';

import MembershipCardTable from './MembershipCardTable.vue';

const draft: AdminMembershipLevelListItem = {
  id: 'draft-1',
  code: 'PEARL_90',
  name: '珍珠季卡',
  rank: 10,
  priceCents: 9900,
  grantCreditCents: 12000,
  discountBasisPoints: 9800,
  validDays: 90,
  benefits: [],
  cardTheme: { theme: MembershipTheme.PEARL, badgeText: 'FRESH BATCH' },
  sortOrder: 10,
  status: MembershipLevelStatus.INACTIVE,
  version: 1,
  purchaseCount: 0,
  createdAt: '2026-07-21T08:00:00.000Z',
  updatedAt: '2026-07-21T09:00:00.000Z',
};

const TableStub = defineComponent({
  name: 'ElTable',
  props: { data: { type: Array, required: true } },
  setup(props) {
    provide('tableRows', props.data);
  },
  template: '<div><slot /></div>',
});
const TableColumnStub = defineComponent({
  name: 'ElTableColumn',
  inject: ['tableRows'],
  template:
    '<section><slot v-for="row in tableRows" :key="row.id" :row="row" /></section>',
});
const ButtonStub = defineComponent({
  name: 'ElButton',
  template: '<button v-bind="$attrs"><slot /></button>',
});
const TagStub = defineComponent({
  name: 'ElTag',
  template: '<span><slot /></span>',
});

function mountTable(levels: readonly AdminMembershipLevelListItem[]) {
  return mount(MembershipCardTable, {
    props: { levels, loading: false, actionId: null },
    global: {
      directives: { loading: {} },
      stubs: {
        ElTable: TableStub,
        ElTableColumn: TableColumnStub,
        ElButton: ButtonStub,
        ElTag: TagStub,
        MembershipCardPreview: true,
      },
    },
  });
}

describe('MembershipCardTable', () => {
  it('不用颜色单独表达状态，并仅给未售下架草稿删除操作', () => {
    const wrapper = mountTable([
      draft,
      {
        ...draft,
        id: 'active-1',
        status: MembershipLevelStatus.ACTIVE,
        purchaseCount: 3,
      },
    ]);

    expect(wrapper.text()).toContain('下架草稿');
    expect(wrapper.text()).toContain('已上架');
    expect(
      wrapper.find('[data-testid="delete-membership-draft-1"]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-testid="delete-membership-active-1"]').exists(),
    ).toBe(false);
  });
});
