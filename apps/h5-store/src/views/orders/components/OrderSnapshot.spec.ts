import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  FulfillmentType,
  OrderStatus,
  type OrderView,
} from '@bake-mall/contracts';

import OrderSnapshot from './OrderSnapshot.vue';

const membershipOrder: OrderView = {
  id: 'order-1',
  orderNo: 'BM2026072600000001',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '小明',
  contactPhone: '13800000000',
  pickupTimeText: '明天上午十点',
  goodsTotalCents: 6800,
  membershipDiscountCents: 680,
  creditAppliedCents: 2000,
  payableTotalCents: 4120,
  membershipId: 'membership-1',
  membershipCode: 'GOLD',
  membershipName: '金卡',
  membershipDiscountBasisPoints: 9000,
  pricingVersion: 1,
  items: [
    {
      id: 'item-1',
      productName: '草莓蛋糕',
      skuName: '6寸',
      skuAttributes: { size: '6寸' },
      unitPriceCents: 6800,
      quantity: 1,
      lineGoodsTotalCents: 6800,
      lineMembershipDiscountCents: 680,
      linePayableCents: 6120,
    },
  ],
  createdAt: '2026-07-26T10:00:00.000Z',
  updatedAt: '2026-07-26T10:00:00.000Z',
};

describe('OrderSnapshot', () => {
  it('shows order and line pricing plus the membership snapshot', () => {
    const wrapper = mount(OrderSnapshot, { props: { order: membershipOrder } });

    expect(wrapper.text()).toContain('商品原价');
    expect(wrapper.text()).toContain('会员优惠');
    expect(wrapper.text()).toContain('消费金抵扣');
    expect(wrapper.text()).toContain('应付金额');
    expect(wrapper.text()).toContain('金卡 · 9 折');
    expect(wrapper.text()).toContain('行原价 ¥68.00');
    expect(wrapper.text()).toContain('优惠 -¥6.80');
    expect(wrapper.text()).toContain('折后 ¥61.20');
    expect(wrapper.text()).toContain('¥41.20');
  });

  it('hides membership snapshot for the no-membership union branch', () => {
    const order: OrderView = {
      ...membershipOrder,
      membershipDiscountCents: 0,
      creditAppliedCents: 0,
      payableTotalCents: 6800,
      items: [
        {
          ...membershipOrder.items[0],
          lineMembershipDiscountCents: 0,
          linePayableCents: 6800,
        },
      ],
      membershipId: undefined,
      membershipCode: undefined,
      membershipName: undefined,
      membershipDiscountBasisPoints: undefined,
    };
    const wrapper = mount(OrderSnapshot, { props: { order } });

    expect(wrapper.text()).not.toContain('会员等级');
    expect(wrapper.text()).not.toContain('会员优惠');
    expect(wrapper.text()).toContain('应付金额');
    expect(wrapper.text()).toContain('¥68.00');
  });
});
