import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OrderDetailView from './OrderDetailView.vue';

import type { OrderView } from '@bake-mall/contracts';

/**
 * OrderDetailView contract pinned by Task 12.
 *
 * - `NEW` orders show only `开始处理`. Completing or cancelling a brand-new
 *   order is illegal (`canTransitionOrder` rejects it), so the buttons must
 *   not render and clicking them is impossible.
 * - `PROCESSING` orders show both `完成订单` and `取消订单`. Both are wired
 *   to emit `update-status` events with the matching `OrderStatus` value so
 *   the parent can call `PATCH /admin/orders/:id/status`.
 * - Terminal states (`COMPLETED` / `CANCELLED`) render no action buttons at
 *   all so the merchant can't mutate frozen snapshots.
 */

function buildOrder(status: OrderView['status']): OrderView {
  return {
    id: 'order-1',
    orderNo: 'BM2026071200000001',
    status,
    fulfillmentType: 'PICKUP',
    contactName: 'Alice',
    contactPhone: '13800000000',
    pickupTimeText: '明天上午十点',
    goodsTotalCents: 6800,
    items: [
      {
        id: 'item-1',
        productName: '示例蛋糕',
        skuName: '6寸',
        skuAttributes: { size: '6寸' },
        unitPriceCents: 6800,
        quantity: 1,
      },
    ],
    createdAt: '2026-07-12T10:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
  };
}

function mountDetail(order: OrderView): VueWrapper {
  return mount(OrderDetailView, {
    props: { order },
    // Provide a no-op router so cancel confirm dialog can resolve without a
    // full vue-router setup; the cancel dialog itself is tested separately.
    global: {
      mocks: {
        $t: (key: string) => key,
      },
    },
  });
}

describe('OrderDetailView', () => {
  it('shows only legal actions for a NEW order', () => {
    const wrapper = mountDetail(buildOrder('NEW'));
    expect(wrapper.text()).toContain('开始处理');
    expect(wrapper.text()).not.toContain('完成订单');
    expect(wrapper.text()).not.toContain('取消订单');
  });

  it('shows both 完成订单 and 取消订单 for a PROCESSING order', () => {
    const wrapper = mountDetail(buildOrder('PROCESSING'));
    expect(wrapper.text()).toContain('完成订单');
    expect(wrapper.text()).toContain('取消订单');
    expect(wrapper.text()).not.toContain('开始处理');
  });

  it('renders no action buttons for terminal orders', () => {
    const completed = mountDetail(buildOrder('COMPLETED'));
    expect(completed.text()).not.toContain('开始处理');
    expect(completed.text()).not.toContain('完成订单');
    expect(completed.text()).not.toContain('取消订单');

    const cancelled = mountDetail(buildOrder('CANCELLED'));
    expect(cancelled.text()).not.toContain('开始处理');
    expect(cancelled.text()).not.toContain('完成订单');
    expect(cancelled.text()).not.toContain('取消订单');
  });

  it('emits PROCESSING when 开始处理 is clicked on a NEW order', async () => {
    const wrapper = mountDetail(buildOrder('NEW'));
    await wrapper.get('[data-testid="start-processing"]').trigger('click');
    expect(wrapper.emitted('update-status')?.[0]).toEqual(['PROCESSING']);
  });

  it('emits CANCELLED when the cancel confirm is accepted', async () => {
    const wrapper = mountDetail(buildOrder('PROCESSING'));
    await wrapper.get('[data-testid="cancel-order"]').trigger('click');
    // Element Plus exposes the confirm button inside ElMessageBox as an
    // .el-message-box__btns .el-button selector, but our wrapper uses the
    // ElMessageBox.confirm proxy: assert via the visible Chinese warning.
    expect(wrapper.text()).toContain('取消订单不会回补库存');
    // Closing the dialog programmatically simulates the merchant clicking
    // the confirm button; the wrapper re-emits update-status.
    await wrapper
      .get('[data-testid="cancel-order-confirm"]')
      .trigger('click');
    expect(wrapper.emitted('update-status')?.[0]).toEqual(['CANCELLED']);
  });
});