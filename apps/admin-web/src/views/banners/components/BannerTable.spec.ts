import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { bannerListMock } from '../mock/list.mock.js';
import BannerTable from './BannerTable.vue';

describe('BannerTable', () => {
  it('uses the shared Admin table class', () => {
    const wrapper = mount(BannerTable, {
      props: {
        banners: bannerListMock,
        loading: false,
        getTargetLabel: () => '无跳转',
      },
      global: { directives: { loading: {} } },
    });

    expect(wrapper.get('.el-table').classes()).toContain('admin-table');
  });
});
