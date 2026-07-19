import { OrderStatus } from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { orderDetailMock } from '../mock/detail.mock.js';
import OrderDetailDrawer from './OrderDetailDrawer.vue';

describe('OrderDetailDrawer', () => {
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
