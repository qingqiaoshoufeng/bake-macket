import {
  HomepageSectionType,
  type HomepageDraftConfig,
} from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import HomepagePhonePreview from './HomepagePhonePreview.vue';

const draft: HomepageDraftConfig = {
  schemaVersion: 1 as const,
  hero: {
    id: 'hero',
    type: HomepageSectionType.HERO_CAROUSEL,
    enabled: false,
    autoplayMs: 0 as const,
    slides: [],
  },
  customerService: {
    id: 'customer-service',
    type: HomepageSectionType.CUSTOMER_SERVICE,
    enabled: false,
    title: '',
    description: '',
    phone: '',
    serviceHours: '',
    wechatQrCode: null,
  },
  shortcutGrid: {
    id: 'shortcut-grid',
    type: HomepageSectionType.SHORTCUT_GRID,
    enabled: false,
    title: '',
    layout: 3 as const,
    items: [],
  },
  imageBlocks: [],
};

describe('HomepagePhonePreview', () => {
  it('keeps the device shell fixed and gives scrolling to the inner screen', () => {
    const wrapper = mount(HomepagePhonePreview, { props: { draft } });

    expect(wrapper.get('[data-preview-device]').attributes('data-aspect')).toBe(
      '390/844',
    );
    expect(wrapper.find('[data-preview-screen]').exists()).toBe(true);
  });
});
