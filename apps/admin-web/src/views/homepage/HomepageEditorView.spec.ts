import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveDraft: vi.fn(),
  publish: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn(),
}));

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>();
  return {
    ...actual,
    ElMessage: {
      success: mocks.success,
      error: mocks.error,
      warning: vi.fn(),
    },
  };
});

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
      saveDraft: mocks.saveDraft,
      publish: mocks.publish,
    }),
  };
});

async function mountView() {
  const { default: HomepageEditorView } =
    await import('./HomepageEditorView.vue');
  return mount(HomepageEditorView, {
    global: {
      stubs: {
        AdminPage: { template: '<main><slot name="header"/><slot/></main>' },
        HomepageEditorForm: true,
        HomepagePhonePreview: true,
      },
    },
  });
}

describe('HomepageEditorView', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('starts directly with the editor workspace without a page introduction', async () => {
    const wrapper = await mountView();

    expect(wrapper.find('.admin-page-header').exists()).toBe(false);
    expect(wrapper.find('.homepage-editor-view__issues').exists()).toBe(false);
    expect(wrapper.find('.homepage-editor-view__workspace').exists()).toBe(
      true,
    );
  });

  it('only shows save success when the hook confirms server success', async () => {
    mocks.saveDraft.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const wrapper = await mountView();
    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('保存草稿'));

    await saveButton?.trigger('click');
    await flushPromises();

    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();

    await saveButton?.trigger('click');
    await flushPromises();

    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledWith('首页草稿已保存');
  });

  it('does not show publish success for a stale failed operation', async () => {
    mocks.publish.mockResolvedValue(false);
    const wrapper = await mountView();
    const publishButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('发布到 H5'));

    await publishButton?.trigger('click');
    await flushPromises();

    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
