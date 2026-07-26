import { OrderStatus } from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { orderDetailMock } from '../mock/detail.mock.js';
import OrderDetailDrawer from './OrderDetailDrawer.vue';

describe('OrderDetailDrawer', () => {
  it('shows header, membership, credit, payable, and line pricing snapshots', async () => {
    const wrapper = mount(OrderDetailDrawer, {
      props: {
        visible: false,
        order: orderDetailMock,
        actions: [],
        loading: false,
        updating: false,
      },
      global: { directives: { loading: {} } },
      attachTo: document.body,
    });
    await wrapper.setProps({ visible: true });

    expect(document.body.textContent).toContain('商品原价');
    expect(document.body.textContent).toContain('会员优惠');
    expect(document.body.textContent).toContain('消费金抵扣');
    expect(document.body.textContent).toContain('应付金额');
    expect(document.body.textContent).toContain('金卡 · 9 折');
    const itemColumnLabels = wrapper
      .findAllComponents({ name: 'ElTableColumn' })
      .map((column) => column.props('label'));
    expect(itemColumnLabels).toContain('行原价');
    expect(itemColumnLabels).toContain('行优惠');
    expect(itemColumnLabels).toContain('折后金额');
    expect(document.body.textContent).toContain('¥41.20');
    wrapper.unmount();
  });

  it('groups immutable snapshots and keeps actions in a sticky footer', async () => {
    const wrapper = mount(OrderDetailDrawer, {
      props: {
        visible: false,
        order: orderDetailMock,
        actions: [
          {
            key: 'start',
            status: OrderStatus.PROCESSING,
            label: '开始处理',
            description: '开始安排生产或配送。',
          },
        ],
        loading: false,
        updating: false,
      },
      global: { directives: { loading: {} } },
      attachTo: document.body,
    });
    await wrapper.setProps({ visible: true });

    expect(
      document.body.querySelectorAll('[data-snapshot-group]').length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      document.body.querySelector('.order-actions--sticky'),
    ).not.toBeNull();
    expect(
      document.body
        .querySelector('[data-testid="order-items-scroll"]')
        ?.classList.contains('admin-horizontal-scroll'),
    ).toBe(true);
    wrapper.unmount();
  });
});
