import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/useHomepageEditor.js', async () => {
  const { computed, ref } = await import('vue');
  const { createHomepageDraft } = await import('./config/defaults.js');

  return {
    useHomepageEditor: () => ({
      draft: ref(createHomepageDraft()),
      categories: ref([]),
      products: ref([]),
      version: ref(1),
      publishedVersion: ref(undefined),
      issues: ref([
        {
          code: 'HERO_REQUIRED',
          message: '请配置首屏轮播',
          sectionId: 'hero',
        },
      ]),
      loading: ref(false),
      saving: ref(false),
      publishing: ref(false),
      dirty: ref(false),
      conflict: ref(null),
      lastError: ref(null),
      canPublish: computed(() => true),
      load: vi.fn(),
      replaceDraft: vi.fn(),
      saveDraft: vi.fn(),
      publish: vi.fn(),
    }),
  };
});

describe('HomepageEditorView', () => {
  it('starts directly with the editor workspace without a page introduction', async () => {
    const { default: HomepageEditorView } =
      await import('./HomepageEditorView.vue');
    const wrapper = mount(HomepageEditorView, {
      global: {
        stubs: {
          AdminPage: { template: '<main><slot name="header"/><slot/></main>' },
          HomepageEditorForm: true,
          HomepagePhonePreview: true,
          HomepagePublishBar: true,
        },
      },
    });

    expect(wrapper.find('.admin-page-header').exists()).toBe(false);
    expect(wrapper.find('.homepage-editor-view__issues').exists()).toBe(false);
    expect(wrapper.find('.homepage-editor-view__workspace').exists()).toBe(
      true,
    );
  });
});
