import {
  HomepageLinkType,
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
    expect(wrapper.get('[data-preview-canvas]').attributes('data-width')).toBe(
      '390',
    );
    expect(wrapper.get('[data-preview-canvas]').attributes('data-height')).toBe(
      '844',
    );
  });

  it('renders persisted homepage assets through the current same-origin proxy', () => {
    const objectKey = 'homepage/demo/v1/hero.webp';
    const stalePublicUrl =
      'https://retired.example.test/bake-mall/homepage/demo/v1/hero.webp';
    const configured: HomepageDraftConfig = {
      ...draft,
      hero: {
        ...draft.hero,
        enabled: true,
        slides: [
          {
            id: 'hero-1',
            image: { objectKey, publicUrl: stalePublicUrl },
            title: '轮播',
            subtitle: '',
            altText: '轮播图',
            link: { type: HomepageLinkType.NONE },
          },
        ],
      },
    };

    const wrapper = mount(HomepagePhonePreview, {
      props: { draft: configured },
    });

    expect(wrapper.get('img[alt="轮播图"]').attributes('src')).toBe(
      `/bake-mall/${objectKey}`,
    );
    expect(wrapper.html()).not.toContain(stalePublicUrl);
  });
});
