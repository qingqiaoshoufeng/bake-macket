import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AdminFilterPanel from './AdminFilterPanel.vue';

describe('AdminFilterPanel', () => {
  it('emits search and reset while toggling advanced fields', async () => {
    const wrapper = mount(AdminFilterPanel, {
      props: { advancedCount: 2 },
      slots: {
        default: '<div data-testid="base-filter">基础筛选</div>',
        advanced: '<div data-testid="advanced-filter">更多筛选</div>',
      },
    });

    expect(wrapper.find('[data-testid="base-filter"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="advanced-filter"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain('更多筛选 (2)');

    await wrapper.get('[data-testid="toggle-advanced"]').trigger('click');
    expect(wrapper.find('[data-testid="advanced-filter"]').exists()).toBe(true);

    await wrapper.get('[data-testid="search-filters"]').trigger('click');
    await wrapper.get('[data-testid="reset-filters"]').trigger('click');
    expect(wrapper.emitted('search')).toHaveLength(1);
    expect(wrapper.emitted('reset')).toHaveLength(1);
    expect(wrapper.find('[data-testid="advanced-filter"]').exists()).toBe(
      false,
    );
  });

  it('disables actions while loading', () => {
    const wrapper = mount(AdminFilterPanel, { props: { loading: true } });
    expect(
      wrapper.get('[data-testid="search-filters"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-testid="reset-filters"]').attributes('disabled'),
    ).toBeDefined();
  });
});
