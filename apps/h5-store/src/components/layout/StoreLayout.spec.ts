import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import StorePage from './StorePage.vue';
import StorePageHeader from './StorePageHeader.vue';
import StoreSection from './StoreSection.vue';
import StoreStatePanel from '../feedback/StoreStatePanel.vue';

describe('H5 visual shell', () => {
  it('exposes safe page spacing classes for tabbar and fixed actions', () => {
    const wrapper = mount(StorePage, {
      props: { withTabbar: true, withFixedAction: true },
      slots: { default: '<p>content</p>' },
    });
    expect(wrapper.classes()).toContain('store-page--with-tabbar');
    expect(wrapper.classes()).toContain('store-page--with-fixed-action');
    expect(wrapper.text()).toContain('content');
  });

  it('renders consistent page and section hierarchy', () => {
    const header = mount(StorePageHeader, {
      props: {
        eyebrow: 'FRESH TODAY',
        title: '今日烘焙',
        description: '门店现做',
      },
    });
    expect(header.get('h1').text()).toBe('今日烘焙');
    expect(header.text()).toContain('FRESH TODAY');

    const section = mount(StoreSection, {
      props: { eyebrow: 'POPULAR', title: '人气烘焙' },
      slots: { default: '<div>products</div>' },
    });
    expect(section.get('h2').text()).toBe('人气烘焙');
    expect(section.text()).toContain('products');
  });

  it('keeps feedback states explicit in text', () => {
    const wrapper = mount(StoreStatePanel, {
      props: {
        state: 'error',
        title: '加载失败',
        description: '请稍后重试',
      },
    });
    expect(wrapper.attributes('data-state')).toBe('error');
    expect(wrapper.text()).toContain('加载失败');
    expect(wrapper.text()).toContain('请稍后重试');
  });
});
