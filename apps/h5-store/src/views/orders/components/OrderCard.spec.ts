import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  FulfillmentType,
  OrderStatus,
  type OrderView,
} from '@bake-mall/contracts';

import OrderCard from './OrderCard.vue';

const order: OrderView = {
  id: 'order-1',
  orderNo: 'BM2026071900000001',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '小明',
  contactPhone: '13800000000',
  pickupTimeText: '明天上午十点',
  goodsTotalCents: 6800,
  items: [],
  createdAt: '2026-07-19T10:00:00.000Z',
  updatedAt: '2026-07-19T10:00:00.000Z',
};

describe('OrderCard', () => {
  it('uses a native button while preserving testid and the open event', async () => {
    const wrapper = mount(OrderCard, { props: { order } });
    const control = wrapper.get('[data-testid="order-order-1"]');

    expect(control.element.tagName).toBe('BUTTON');
    expect(control.attributes('type')).toBe('button');
    await control.trigger('click');
    expect(wrapper.emitted('open')).toEqual([[order]]);
  });
});
