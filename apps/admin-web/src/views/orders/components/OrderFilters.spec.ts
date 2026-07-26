import {
  BooleanFilter,
  FulfillmentType,
  OrderStatus,
} from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { ElButton } from 'element-plus';
import { describe, expect, it } from 'vitest';

import AdminFilterPanel from '../../../components/filters/AdminFilterPanel.vue';
import { createOrderFilterDefaults } from '../config/defaults.js';
import OrderFilters from './OrderFilters.vue';

describe('OrderFilters', () => {
  it('renders basic fields in the shared panel and reveals all advanced fields', async () => {
    const wrapper = mount(OrderFilters, {
      props: {
        filters: createOrderFilterDefaults(),
        loading: false,
        advancedCount: 0,
      },
      global: { components: { ElButton } },
    });

    expect(wrapper.findComponent(AdminFilterPanel).exists()).toBe(true);
    expect(wrapper.text()).toContain('订单号');
    expect(wrapper.text()).toContain('联系人 / 手机号');
    expect(wrapper.text()).toContain('状态');
    expect(wrapper.text()).toContain('履约方式');
    expect(wrapper.text()).not.toContain('用户 ID');

    await wrapper.get('[data-testid="toggle-advanced"]').trigger('click');

    expect(wrapper.text()).toContain('用户 ID');
    expect(wrapper.text()).toContain('商品 / SKU');
    expect(wrapper.text()).toContain('是否会员');
    expect(wrapper.text()).toContain('是否消费金');
    expect(wrapper.text()).toContain('有无备注');
    expect(wrapper.text()).toContain('最低应付（元）');
    expect(wrapper.text()).toContain('最高应付（元）');
    expect(wrapper.text()).toContain('下单时间');
  });

  it('emits typed changes for basic and advanced selectors', async () => {
    const wrapper = mount(OrderFilters, {
      props: {
        filters: createOrderFilterDefaults(),
        loading: false,
        advancedCount: 0,
      },
      global: { components: { ElButton } },
    });
    const selects = wrapper.findAllComponents({ name: 'ElSelect' });

    await selects[0].vm.$emit('update:modelValue', OrderStatus.PROCESSING);
    await selects[1].vm.$emit('update:modelValue', FulfillmentType.DELIVERY);
    await wrapper.get('[data-testid="toggle-advanced"]').trigger('click');
    const allSelects = wrapper.findAllComponents({ name: 'ElSelect' });
    await allSelects[2].vm.$emit('update:modelValue', BooleanFilter.YES);

    expect(wrapper.emitted('change')).toEqual([
      [{ status: OrderStatus.PROCESSING }],
      [{ fulfillmentType: FulfillmentType.DELIVERY }],
      [{ usesMembership: BooleanFilter.YES }],
    ]);
  });
});
