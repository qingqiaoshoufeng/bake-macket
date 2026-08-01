import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  editorLoad: vi.fn(),
  draftsLoad: vi.fn(),
  saveDraft: vi.fn(),
  publish: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(),
  activeId: '12' as string | null,
  draftId: '12' as string | null,
  conflict: null as string | null,
  activeIdRef: undefined as { value: string | null } | undefined,
  draftsErrorRef: undefined as { value: string | null } | undefined,
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
    ElMessageBox: {
      confirm: mocks.confirm,
    },
  };
});

vi.mock('./hooks/useHomepageEditor.js', async () => {
  const { computed, ref } = await import('vue');
  const { createHomepageDraft } = await import('./config/defaults.js');

  return {
    useHomepageEditor: () => ({
      draftId: ref(mocks.draftId),
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
      conflict: ref(mocks.conflict),
      lastError: ref(null),
      canPublish: computed(() => true),
      load: mocks.editorLoad,
      replaceDraft: vi.fn(),
      saveDraft: mocks.saveDraft,
      publish: mocks.publish,
    }),
  };
});

vi.mock('./hooks/useHomepageDrafts.js', async () => {
  const { ref } = await import('vue');
  mocks.activeIdRef = ref(mocks.activeId);
  mocks.draftsErrorRef = ref(null);

  return {
    useHomepageDrafts: () => ({
      activeId: mocks.activeIdRef,
      loading: ref(false),
      error: mocks.draftsErrorRef,
      load: mocks.draftsLoad,
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
  beforeEach(() => {
    mocks.activeId = '12';
    mocks.draftId = '12';
    mocks.conflict = null;
    if (mocks.activeIdRef) mocks.activeIdRef.value = '12';
    if (mocks.draftsErrorRef) mocks.draftsErrorRef.value = null;
    mocks.draftsLoad.mockResolvedValue(true);
    mocks.editorLoad.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('loads the draft list before loading its active editor draft', async () => {
    const calls: string[] = [];
    mocks.draftsLoad.mockImplementation(async () => {
      calls.push('drafts');
      return true;
    });
    mocks.editorLoad.mockImplementation(async () => {
      calls.push('editor');
    });

    await mountView();
    await flushPromises();

    expect(mocks.draftsLoad).toHaveBeenCalledOnce();
    expect(mocks.draftsLoad).toHaveBeenCalledWith();
    expect(mocks.editorLoad).toHaveBeenCalledOnce();
    expect(mocks.editorLoad).toHaveBeenCalledWith('12');
    expect(calls).toEqual(['drafts', 'editor']);
  });

  it('does not load an editor draft when the draft-list load is stale', async () => {
    mocks.draftsLoad.mockResolvedValue(false);

    await mountView();
    await flushPromises();

    expect(mocks.draftsLoad).toHaveBeenCalledOnce();
    expect(mocks.editorLoad).not.toHaveBeenCalled();
  });

  it('shows an empty state without editor controls when no draft exists', async () => {
    mocks.activeId = null;
    mocks.draftId = null;
    if (mocks.activeIdRef) mocks.activeIdRef.value = null;

    const wrapper = await mountView();
    await flushPromises();

    expect(mocks.draftsLoad).toHaveBeenCalledOnce();
    expect(mocks.editorLoad).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('还没有首页草稿，请先创建草稿');
    expect(wrapper.findComponent({ name: 'HomepageEditorForm' }).exists()).toBe(
      false,
    );
    expect(wrapper.find('.homepage-publish-bar').exists()).toBe(false);
  });

  it('reports a current draft-list failure once without editor controls', async () => {
    mocks.draftId = null;
    mocks.draftsLoad.mockImplementation(async () => {
      mocks.draftsErrorRef!.value = '首页草稿列表加载失败';
      return true;
    });

    const wrapper = await mountView();
    await flushPromises();

    expect(mocks.editorLoad).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledWith('首页草稿列表加载失败');
    expect(mocks.success).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('首页草稿列表加载失败');
    expect(wrapper.findComponent({ name: 'HomepageEditorForm' }).exists()).toBe(
      false,
    );
    expect(wrapper.find('.homepage-publish-bar').exists()).toBe(false);
  });

  it('starts directly with the editor workspace without a page introduction', async () => {
    const wrapper = await mountView();

    expect(wrapper.find('.admin-page-header').exists()).toBe(false);
    expect(wrapper.find('.homepage-editor-view__issues').exists()).toBe(false);
    expect(wrapper.find('.homepage-editor-view__workspace').exists()).toBe(
      true,
    );
  });

  it('does not show reload success when the editor detail fails to load', async () => {
    mocks.conflict = '服务器草稿已更新';
    const wrapper = await mountView();
    await flushPromises();
    mocks.success.mockClear();
    mocks.error.mockClear();
    mocks.editorLoad.mockRejectedValueOnce(new Error('详情加载失败'));
    const reloadButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('重新加载服务器草稿'));

    await reloadButton?.trigger('click');
    await flushPromises();

    expect(mocks.error).toHaveBeenCalledWith('详情加载失败');
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('does not show reload success when the refreshed list has no active draft', async () => {
    mocks.conflict = '服务器草稿已更新';
    const wrapper = await mountView();
    await flushPromises();
    mocks.success.mockClear();
    mocks.activeIdRef!.value = null;
    const reloadButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('重新加载服务器草稿'));

    await reloadButton?.trigger('click');
    await flushPromises();

    expect(mocks.editorLoad).toHaveBeenCalledOnce();
    expect(mocks.success).not.toHaveBeenCalled();
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
