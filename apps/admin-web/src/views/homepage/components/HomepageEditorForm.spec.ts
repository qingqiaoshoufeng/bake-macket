import { readFileSync } from 'node:fs';

import {
  HomepageLinkType,
  HomepageSectionType,
  type HomepageDraftConfig,
  type HomepageValidationIssue,
} from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import HomepageEditorForm from './HomepageEditorForm.vue';

const draft: HomepageDraftConfig = {
  schemaVersion: 1,
  hero: {
    id: 'hero',
    type: HomepageSectionType.HERO_CAROUSEL,
    enabled: true,
    autoplayMs: 5000,
    slides: [
      {
        id: 'hero-1',
        image: null,
        title: '第一张',
        subtitle: '',
        altText: '',
        link: { type: HomepageLinkType.NONE },
      },
      {
        id: 'hero-2',
        image: null,
        title: '第二张',
        subtitle: '',
        altText: '',
        link: { type: HomepageLinkType.NONE },
      },
    ],
  },
  customerService: {
    id: 'customer-service',
    type: HomepageSectionType.CUSTOMER_SERVICE,
    enabled: true,
    title: '联系客服',
    description: '',
    phone: '13800000000',
    serviceHours: '09:00-20:00',
    wechatQrCode: null,
  },
  shortcutGrid: {
    id: 'shortcut-grid',
    type: HomepageSectionType.SHORTCUT_GRID,
    enabled: true,
    title: '快捷入口',
    layout: 3,
    items: ['shortcut-1', 'shortcut-2', 'shortcut-3'].map((id, index) => ({
      id,
      label: `入口 ${index + 1}`,
      image: null,
      link: { type: HomepageLinkType.NONE },
    })),
  },
  imageBlocks: [
    {
      id: 'image-1',
      type: HomepageSectionType.IMAGE_BLOCK,
      enabled: true,
      image: null,
      title: '配图一',
      description: '',
      altText: '',
      link: { type: HomepageLinkType.NONE },
    },
    {
      id: 'image-2',
      type: HomepageSectionType.IMAGE_BLOCK,
      enabled: true,
      image: null,
      title: '配图二',
      description: '',
      altText: '',
      link: { type: HomepageLinkType.NONE },
    },
  ],
};

function mountForm(
  issues: readonly HomepageValidationIssue[] = [],
): ReturnType<typeof mount<typeof HomepageEditorForm>> {
  return mount(HomepageEditorForm, {
    props: { draft, categories: [], products: [], issues },
    global: {
      stubs: {
        CosImageUploader: true,
        HomepageLinkEditor: true,
      },
    },
  });
}

describe('HomepageEditorForm', () => {
  it('keeps the tab row at its content height inside a taller editor track', () => {
    const source = readFileSync(
      `${process.cwd()}/src/views/homepage/components/HomepageEditorForm.vue`,
      'utf8',
    );

    expect(source).toMatch(
      /\.homepage-editor-form \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?align-content: start/,
    );
  });

  it('shows one configuration type at a time', async () => {
    const wrapper = mountForm();

    expect(wrapper.get('[data-editor-panel="hero"]').isVisible()).toBe(true);
    expect(
      wrapper.find('[data-editor-panel="customer-service"]').exists(),
    ).toBe(false);

    await wrapper.get('[data-editor-tab="customer-service"]').trigger('click');

    expect(wrapper.find('[data-editor-panel="hero"]').exists()).toBe(false);
    expect(
      wrapper.get('[data-editor-panel="customer-service"]').isVisible(),
    ).toBe(true);
  });

  it('marks affected section and item tabs with validation dots', async () => {
    const wrapper = mountForm([
      {
        code: 'HERO_IMAGE_REQUIRED',
        message: '请上传轮播图',
        sectionId: 'hero',
        itemId: 'hero-2',
        field: 'image',
      },
      {
        code: 'SERVICE_PHONE_REQUIRED',
        message: '请填写客服电话',
        sectionId: 'customer-service',
        field: 'phone',
      },
    ]);

    expect(
      wrapper.find('[data-editor-tab="hero"] [data-validation-dot]').exists(),
    ).toBe(true);
    expect(
      wrapper
        .find('[data-editor-tab="customer-service"] [data-validation-dot]')
        .exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-item-tab="hero-2"] [data-validation-dot]').exists(),
    ).toBe(true);
    expect(
      wrapper.find('[data-item-tab="hero-1"] [data-validation-dot]').exists(),
    ).toBe(false);
    expect(wrapper.get('.homepage-repeater').classes()).toContain(
      'homepage-repeater--vertical',
    );
  });

  it('opens the requested type and repeated item for validation navigation', async () => {
    const wrapper = mountForm();

    wrapper.vm.openItem('image-2');
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-editor-panel="image-blocks"]').isVisible()).toBe(
      true,
    );
    expect(wrapper.get('[data-item-tab="image-2"]').classes()).toContain(
      'is-active',
    );
    expect(wrapper.get('#image-2').isVisible()).toBe(true);
  });
});
