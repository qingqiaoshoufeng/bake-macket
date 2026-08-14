import {
  AdminRole,
  FulfillmentType,
  OPERATOR_PERMISSIONS,
  OrderStatus,
  SUPER_ADMIN_PERMISSIONS,
  type AdminOrderListItem,
  type AdminSessionView,
  type OrderView,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { ElButton } from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminFilterPanel from '../../components/filters/AdminFilterPanel.vue';
import AdminDataPanel from '../../components/layout/AdminDataPanel.vue';
import AdminPage from '../../components/layout/AdminPage.vue';
import { PAGE_SIZE_OPTIONS } from '../../config/pagination.js';
import { useAdminAuthStore } from '../../stores/admin-auth.js';
import { ordersApi } from './api/index.js';
import OrderDetailDrawer from './components/OrderDetailDrawer.vue';
import OrderFilters from './components/OrderFilters.vue';
import OrderModeSwitch from './components/OrderModeSwitch.vue';
import OrderTable from './components/OrderTable.vue';
import OrdersView from './OrdersView.vue';

vi.mock('./api/index.js', () => ({
  ordersApi: {
    list: vi.fn(),
    getOne: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

const api = vi.mocked(ordersApi);
const orderRow: AdminOrderListItem = {
  id: 'order-1',
  orderNo: 'BM2026080600000001',
  userId: 'user-1',
  status: OrderStatus.NEW,
  fulfillmentType: FulfillmentType.PICKUP,
  contactName: '张三',
  contactPhone: '13800000000',
  itemLineCount: 1,
  totalQuantity: 1,
  goodsTotalCents: 6800,
  membershipDiscountCents: 0,
  creditAppliedCents: 0,
  payableTotalCents: 6800,
  createdAt: '2026-08-06T08:00:00.000Z',
  updatedAt: '2026-08-06T08:00:00.000Z',
};
const orderDetail: OrderView = {
  ...orderRow,
  membershipId: 'membership-1',
  membershipCode: 'MEMBER',
  membershipName: '会员',
  membershipDiscountBasisPoints: 10000,
  pricingVersion: 1,
  pickupTimeText: '2026-08-07 10:00',
  items: [
    {
      id: 'item-1',
      productName: '草莓蛋糕',
      skuName: '6 寸',
      skuAttributes: { size: '6寸' },
      unitPriceCents: 6800,
      quantity: 1,
      lineGoodsTotalCents: 6800,
      lineMembershipDiscountCents: 0,
      linePayableCents: 6800,
    },
  ],
};
const superAdminSession: AdminSessionView = {
  accessToken: 'super-token',
  expiresAt: '2099-08-06T12:00:00.000Z',
  role: AdminRole.SUPER_ADMIN,
  permissions: SUPER_ADMIN_PERMISSIONS,
  mustChangePassword: false,
};
const operatorSession: AdminSessionView = {
  accessToken: 'operator-token',
  expiresAt: '2099-08-06T12:00:00.000Z',
  role: AdminRole.OPERATOR,
  permissions: OPERATOR_PERMISSIONS,
  mustChangePassword: false,
};

function mountView(session: AdminSessionView) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAdminAuthStore(pinia).applySession(session, { identifier: 'admin' });
  return mount(OrdersView, {
    global: {
      plugins: [pinia],
      components: { ElButton },
      directives: { loading: {} },
    },
  });
}

describe('OrdersView', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.resetAllMocks();
  });

  it('uses shared page layout, adaptive filter panel, and pagination options', async () => {
    api.list.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    const wrapper = mountView(superAdminSession);
    await flushPromises();

    expect(wrapper.find('.admin-page').exists()).toBe(true);
    expect(wrapper.find('.admin-page-header').exists()).toBe(true);
    expect(wrapper.find('.admin-data-panel').exists()).toBe(true);
    expect(wrapper.getComponent(AdminPage).props('workspace')).toBe(true);
    expect(wrapper.getComponent(AdminDataPanel).props('fill')).toBe(true);
    expect(
      wrapper
        .findComponent(OrderFilters)
        .findComponent(AdminFilterPanel)
        .exists(),
    ).toBe(true);
    const pagination = wrapper.findComponent({ name: 'ElPagination' });
    expect(pagination.props('pageSizes')).toEqual([...PAGE_SIZE_OPTIONS]);
  });

  it('shows supply mode and export controls to SUPER_ADMIN', async () => {
    api.list.mockResolvedValueOnce({
      items: [orderRow],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    const wrapper = mountView(superAdminSession);
    await flushPromises();

    expect(wrapper.findComponent(OrderModeSwitch).exists()).toBe(true);
    expect(wrapper.find('[data-testid="supply-mode"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="export-orders"]').exists()).toBe(true);
    expect(wrapper.findComponent(OrderTable).props('orders')).toEqual([
      orderRow,
    ]);
  });

  it('hides supply mode and export controls from OPERATOR while preserving order list and status actions', async () => {
    api.list.mockResolvedValueOnce({
      items: [orderRow],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    api.getOne.mockResolvedValueOnce(orderDetail);

    const wrapper = mountView(operatorSession);
    await flushPromises();

    expect(wrapper.findComponent(OrderModeSwitch).exists()).toBe(false);
    expect(wrapper.find('[data-testid="supply-mode"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="export-orders"]').exists()).toBe(false);
    expect(wrapper.findComponent(OrderTable).props('orders')).toEqual([
      orderRow,
    ]);

    wrapper.findComponent(OrderTable).vm.$emit('open', orderRow.id);
    await flushPromises();

    expect(api.getOne).toHaveBeenCalledWith(orderRow.id);
    expect(wrapper.findComponent(OrderDetailDrawer).props('actions')).toEqual([
      {
        key: 'start',
        status: OrderStatus.PROCESSING,
        label: '开始处理',
        description: '将订单状态从“待处理”切换为“处理中”,准备安排生产或发货。',
      },
    ]);
  });
});
