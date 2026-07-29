import { AdminOrderExportView } from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OrderModeSwitch from './OrderModeSwitch.vue';

describe('OrderModeSwitch', () => {
  it('emits mode changes and export separately', async () => {
    const wrapper = mount(OrderModeSwitch, {
      props: { modelValue: AdminOrderExportView.ORDER, exporting: false },
    });

    await wrapper.get('input[value="SUPPLY"]').setValue(true);
    await wrapper.get('[data-testid="export-orders"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')?.flat()).toContain(
      AdminOrderExportView.SUPPLY,
    );
    expect(wrapper.emitted('export')).toHaveLength(1);
  });
});
