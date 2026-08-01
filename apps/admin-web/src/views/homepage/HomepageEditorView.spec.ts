import { readFileSync } from 'node:fs';

import {
  HomepageDraftStatus,
  type AdminHomepageDraftSummary,
  type AdminHomepageView,
} from '@bake-mall/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createHomepageDraft } from './config/defaults.js';

const mocks = vi.hoisted(() => ({
  editorLoad: vi.fn(),
  draftsLoad: vi.fn(),
  draftsRefresh: vi.fn(),
  draftsSelect: vi.fn(),
  draftsCreate: vi.fn(),
  draftsRename: vi.fn(),
  draftsRemove: vi.fn(),
  draftsReconcileDetail: vi.fn(),
  editorReconcileMetadata: vi.fn(),
  saveDraft: vi.fn(),
  publish: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  routeLeaveGuard: undefined as (() => Promise<boolean>) | undefined,
  activeIdRef: undefined as { value: string | null } | undefined,
  draftsErrorRef: undefined as { value: string | null } | undefined,
  draftsPageRef: undefined as { value: number } | undefined,
  draftsPageSizeRef: undefined as { value: number } | undefined,
  draftsItemsRef: undefined as
    { value: readonly AdminHomepageDraftSummary[] } | undefined,
  draftIdRef: undefined as { value: string | null } | undefined,
  dirtyRef: undefined as { value: boolean } | undefined,
  savingRef: undefined as { value: boolean } | undefined,
  publishingRef: undefined as { value: boolean } | undefined,
  conflictRef: undefined as { value: string | null } | undefined,
}));

const timestamps = {
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
};

const ordinary = {
  id: '12',
  name: '日常首页',
  status: HomepageDraftStatus.DRAFT,
  version: 3,
  ...timestamps,
};
const second = {
  id: '13',
  name: '节日首页',
  status: HomepageDraftStatus.DRAFT,
  version: 2,
  ...timestamps,
};
const published = {
  id: '14',
  name: '线上首页',
  status: HomepageDraftStatus.PUBLISHED,
  version: 5,
  ...timestamps,
};

function detail(
  id: string,
  overrides: Partial<AdminHomepageView> = {},
): AdminHomepageView {
  return {
    id,
    pageKey: 'HOME',
    name: `草稿 ${id}`,
    status: HomepageDraftStatus.DRAFT,
    draftConfig: createHomepageDraft(),
    publishedConfig: null,
    version: 3,
    draftIssues: [],
    ...timestamps,
    ...overrides,
  };
}

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn((guard: () => Promise<boolean>) => {
    mocks.routeLeaveGuard = guard;
  }),
}));

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>();
  return {
    ...actual,
    ElMessage: {
      success: mocks.success,
      error: mocks.error,
      warning: mocks.warning,
    },
    ElMessageBox: {
      confirm: mocks.confirm,
      prompt: mocks.prompt,
    },
  };
});

vi.mock('./hooks/useHomepageEditor.js', async () => {
  const { computed, ref } = await import('vue');
  const { createHomepageDraft } = await import('./config/defaults.js');
  mocks.draftIdRef = ref('12');
  mocks.dirtyRef = ref(false);
  mocks.savingRef = ref(false);
  mocks.publishingRef = ref(false);
  mocks.conflictRef = ref(null);

  return {
    useHomepageEditor: () => ({
      draftId: mocks.draftIdRef,
      name: ref('日常首页'),
      status: ref(HomepageDraftStatus.DRAFT),
      draft: ref(createHomepageDraft()),
      categories: ref([]),
      products: ref([]),
      version: ref(3),
      publishedVersion: ref(undefined),
      issues: ref([
        {
          code: 'HERO_REQUIRED',
          message: '请配置首屏轮播',
          sectionId: 'hero',
        },
      ]),
      loading: ref(false),
      saving: mocks.savingRef,
      publishing: mocks.publishingRef,
      dirty: mocks.dirtyRef,
      conflict: mocks.conflictRef,
      lastError: ref(null),
      canPublish: computed(() => !mocks.dirtyRef!.value),
      load: mocks.editorLoad,
      replaceDraft: vi.fn(),
      reconcileMetadata: mocks.editorReconcileMetadata,
      saveDraft: mocks.saveDraft,
      publish: mocks.publish,
    }),
  };
});

vi.mock('./hooks/useHomepageDrafts.js', async () => {
  const { ref } = await import('vue');
  mocks.activeIdRef = ref('12');
  mocks.draftsErrorRef = ref(null);

  return {
    useHomepageDrafts: () => {
      mocks.draftsPageRef = ref(1);
      mocks.draftsPageSizeRef = ref(20);
      mocks.draftsItemsRef = ref([ordinary, second, published]);
      return {
        items: mocks.draftsItemsRef,
        activeId: mocks.activeIdRef,
        page: mocks.draftsPageRef,
        pageSize: mocks.draftsPageSizeRef,
        total: ref(3),
        loading: ref(false),
        error: mocks.draftsErrorRef,
        load: mocks.draftsLoad,
        refresh: mocks.draftsRefresh,
        select: mocks.draftsSelect,
        create: mocks.draftsCreate,
        rename: mocks.draftsRename,
        remove: mocks.draftsRemove,
        reconcileDetail: mocks.draftsReconcileDetail,
      };
    },
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
        ElDialog: {
          props: ['modelValue'],
          emits: ['close'],
          template:
            '<section v-if="modelValue"><slot/><slot name="footer"/></section>',
        },
      },
    },
  });
}

function draftRow(wrapper: Awaited<ReturnType<typeof mountView>>, id: string) {
  return wrapper.find(`[data-draft-id="${id}"]`);
}

function actionButton(
  wrapper: Awaited<ReturnType<typeof mountView>>,
  label: string,
) {
  return wrapper
    .findAll('button')
    .find((button) => button.text().includes(label));
}

describe('HomepageEditorView', () => {
  beforeAll(async () => {
    await import('./HomepageEditorView.vue');
  });

  beforeEach(() => {
    mocks.activeIdRef!.value = '12';
    mocks.draftsErrorRef!.value = null;
    mocks.draftIdRef!.value = '12';
    mocks.dirtyRef!.value = false;
    mocks.savingRef!.value = false;
    mocks.publishingRef!.value = false;
    mocks.conflictRef!.value = null;
    mocks.draftsLoad.mockResolvedValue(true);
    mocks.draftsRefresh.mockResolvedValue(undefined);
    mocks.editorLoad.mockResolvedValue(undefined);
    mocks.saveDraft.mockResolvedValue(
      detail('12', { name: '日常首页', version: 4 }),
    );
    mocks.publish.mockResolvedValue(true);
    mocks.confirm.mockResolvedValue(undefined);
    mocks.prompt.mockResolvedValue({ value: '新名称' });
    mocks.draftsCreate.mockImplementation(async () => {
      mocks.activeIdRef!.value = '99';
      return { id: '99' };
    });
    mocks.draftsRemove.mockImplementation(async (id: string) => {
      if (mocks.activeIdRef!.value === id) mocks.activeIdRef!.value = '13';
    });
    mocks.draftsSelect.mockImplementation((id: string) => {
      mocks.activeIdRef!.value = id;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
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

    expect(mocks.draftsLoad).toHaveBeenCalledWith();
    expect(mocks.editorLoad).toHaveBeenCalledWith('12');
    expect(calls).toEqual(['drafts', 'editor']);
  });

  it('does not load an editor draft when the draft-list load is stale', async () => {
    mocks.draftsLoad.mockResolvedValue(false);

    await mountView();
    await flushPromises();

    expect(mocks.editorLoad).not.toHaveBeenCalled();
  });

  it('renders draft, editor, and preview columns without the old introduction', async () => {
    const wrapper = await mountView();

    expect(wrapper.find('.admin-page-header').exists()).toBe(false);
    expect(wrapper.find('.homepage-editor-view__issues').exists()).toBe(false);
    expect(wrapper.find('[data-workspace-column="drafts"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-workspace-column="editor"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-workspace-column="preview"]').exists()).toBe(
      true,
    );
  });

  it('keeps a scrollable non-zero editor track in the narrow workspace', () => {
    const source = readFileSync(
      `${process.cwd()}/src/views/homepage/HomepageEditorView.vue`,
      'utf8',
    );

    expect(source).toMatch(
      /@media \(max-width: 1400px\) \{[\s\S]*?\.homepage-editor-view__layout \{[\s\S]*?grid-template-columns: minmax\(180px, 0\.32fr\) minmax\(0, 1fr\);[\s\S]*?grid-template-areas:[\s\S]*?'drafts editor'[\s\S]*?'drafts preview'[\s\S]*?grid-template-rows: minmax\(520px, auto\) auto;[\s\S]*?overflow-y: auto/,
    );
    expect(source).toMatch(
      /@media \(max-width: 1400px\) \{[\s\S]*?\.homepage-editor-view__configuration \{[\s\S]*?min-height: 520px;[\s\S]*?overflow: visible/,
    );
    expect(source).toMatch(
      /@media \(max-width: 1400px\) \{[\s\S]*?\.homepage-editor-view__layout > \[data-workspace-column='drafts'\] \{[\s\S]*?position: sticky;[\s\S]*?grid-row: 1 \/ -1/,
    );
    expect(source).toMatch(
      /@media \(max-width: 1400px\) \{[\s\S]*?\.homepage-editor-view__preview :deep\(\.homepage-phone-preview\) \{[\s\S]*?min-height: 560px/,
    );
  });

  it('loads and selects a clean target draft', async () => {
    const wrapper = await mountView();
    await flushPromises();
    mocks.editorLoad.mockClear();

    await draftRow(wrapper, '13').trigger('click');
    await flushPromises();

    expect(mocks.editorLoad).toHaveBeenCalledWith('13');
    expect(mocks.draftsSelect).toHaveBeenCalledWith('13');
  });

  it.each([
    ['saving', 'savingRef'],
    ['publishing', 'publishingRef'],
  ] as const)(
    'ignores draft selection while the editor is %s',
    async (_, state) => {
      mocks[state]!.value = true;
      const wrapper = await mountView();
      await flushPromises();
      mocks.editorLoad.mockClear();

      await draftRow(wrapper, '13').trigger('click');
      await flushPromises();

      expect(mocks.editorLoad).not.toHaveBeenCalled();
      expect(mocks.draftsSelect).not.toHaveBeenCalled();
    },
  );

  it('hides stale editor content when the selected and loaded draft IDs differ', async () => {
    mocks.activeIdRef!.value = '13';
    const wrapper = await mountView();
    await flushPromises();

    expect(wrapper.findComponent({ name: 'HomepageEditorForm' }).exists()).toBe(
      false,
    );
    expect(
      wrapper.findComponent({ name: 'HomepagePhonePreview' }).exists(),
    ).toBe(false);
    expect(wrapper.find('.homepage-publish-bar').exists()).toBe(false);
  });

  it('ignores a second selection while a dirty switch confirmation is open', async () => {
    mocks.dirtyRef!.value = true;
    const pendingConfirm = new Promise<void>(() => undefined);
    mocks.confirm.mockReturnValueOnce(pendingConfirm);
    const wrapper = await mountView();
    await flushPromises();
    mocks.editorLoad.mockClear();

    await draftRow(wrapper, '13').trigger('click');
    await draftRow(wrapper, '14').trigger('click');
    await flushPromises();

    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.editorLoad).not.toHaveBeenCalled();
    expect(mocks.draftsSelect).not.toHaveBeenCalled();
  });

  it('saves without refreshing another page, reconciles the current summary, and switches', async () => {
    mocks.dirtyRef!.value = true;
    const wrapper = await mountView();
    await flushPromises();
    mocks.editorLoad.mockClear();
    mocks.draftsLoad.mockClear();
    mocks.draftsLoad.mockImplementation(async () => {
      mocks.draftsItemsRef!.value = [ordinary];
      return true;
    });

    await draftRow(wrapper, '13').trigger('click');
    await flushPromises();

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining('尚未保存'),
      expect.any(String),
      expect.objectContaining({
        confirmButtonText: '保存并切换',
        cancelButtonText: '放弃修改并切换',
        distinguishCancelAndClose: true,
      }),
    );
    expect(mocks.saveDraft).toHaveBeenCalledOnce();
    expect(mocks.draftsLoad).not.toHaveBeenCalled();
    expect(mocks.draftsReconcileDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: '12', version: 4 }),
    );
    expect(mocks.editorLoad).toHaveBeenCalledWith('13');
    expect(mocks.draftsSelect).toHaveBeenCalledWith('13');
    expect(mocks.draftsItemsRef!.value).toContainEqual(second);
  });

  it('discards local changes and switches when dirty confirmation is cancelled', async () => {
    mocks.dirtyRef!.value = true;
    mocks.confirm.mockRejectedValue('cancel');
    const wrapper = await mountView();
    await flushPromises();
    mocks.editorLoad.mockClear();

    await draftRow(wrapper, '13').trigger('click');
    await flushPromises();

    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.editorLoad).toHaveBeenCalledWith('13');
    expect(mocks.draftsSelect).toHaveBeenCalledWith('13');
  });

  it('keeps the current draft when dirty switching is closed', async () => {
    mocks.dirtyRef!.value = true;
    mocks.confirm.mockRejectedValue('close');
    const wrapper = await mountView();
    await flushPromises();
    mocks.editorLoad.mockClear();

    await draftRow(wrapper, '13').trigger('click');
    await flushPromises();

    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.editorLoad).not.toHaveBeenCalled();
    expect(mocks.draftsSelect).not.toHaveBeenCalled();
    expect(mocks.activeIdRef!.value).toBe('12');
  });

  it.each([
    ['returns false', async () => false],
    ['throws', async () => Promise.reject(new Error('保存失败'))],
  ])('does not switch when dirty save %s', async (_, saveResult) => {
    mocks.dirtyRef!.value = true;
    mocks.saveDraft.mockImplementationOnce(saveResult);
    const wrapper = await mountView();
    await flushPromises();
    mocks.editorLoad.mockClear();

    await draftRow(wrapper, '13').trigger('click');
    await flushPromises();

    expect(mocks.editorLoad).not.toHaveBeenCalled();
    expect(mocks.draftsSelect).not.toHaveBeenCalled();
  });

  it('saves dirty content before creating so COPY uses the saved server config', async () => {
    mocks.dirtyRef!.value = true;
    const wrapper = await mountView();
    await flushPromises();

    await actionButton(wrapper, '新建')?.trigger('click');
    wrapper
      .findComponent({ name: 'HomepageDraftCreateDialog' })
      .vm.$emit('submit', { name: '复制已保存方案', mode: 'COPY' });
    await flushPromises();

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining('尚未保存'),
      expect.any(String),
      expect.objectContaining({
        confirmButtonText: '保存并创建',
        cancelButtonText: '放弃修改并创建',
        distinguishCancelAndClose: true,
      }),
    );
    expect(mocks.saveDraft).toHaveBeenCalledOnce();
    expect(mocks.draftsCreate).toHaveBeenCalledWith({
      name: '复制已保存方案',
      mode: 'COPY',
    });
    expect(mocks.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.draftsCreate.mock.invocationCallOrder[0]!,
    );
    expect(mocks.editorLoad).toHaveBeenLastCalledWith('99');
  });

  it('discards dirty content and creates without saving', async () => {
    mocks.dirtyRef!.value = true;
    mocks.confirm.mockRejectedValueOnce('cancel');
    const wrapper = await mountView();
    await flushPromises();

    await actionButton(wrapper, '新建')?.trigger('click');
    wrapper
      .findComponent({ name: 'HomepageDraftCreateDialog' })
      .vm.$emit('submit', { name: '空白方案', mode: 'BLANK' });
    await flushPromises();

    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.draftsCreate).toHaveBeenCalledWith({
      name: '空白方案',
      mode: 'BLANK',
    });
    expect(mocks.editorLoad).toHaveBeenLastCalledWith('99');
  });

  it('keeps the create dialog open and does not create when dirty resolution is closed', async () => {
    mocks.dirtyRef!.value = true;
    mocks.confirm.mockRejectedValueOnce('close');
    const wrapper = await mountView();
    await flushPromises();

    await actionButton(wrapper, '新建')?.trigger('click');
    wrapper
      .findComponent({ name: 'HomepageDraftCreateDialog' })
      .vm.$emit('submit', { name: '取消方案', mode: 'BLANK' });
    await flushPromises();

    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.draftsCreate).not.toHaveBeenCalled();
    expect(
      wrapper
        .findComponent({ name: 'HomepageDraftCreateDialog' })
        .props('visible'),
    ).toBe(true);
  });

  it.each([
    ['returns false', async () => false],
    ['throws', async () => Promise.reject(new Error('保存失败'))],
  ])('does not create when dirty save %s', async (_, saveResult) => {
    mocks.dirtyRef!.value = true;
    mocks.saveDraft.mockImplementationOnce(saveResult);
    const wrapper = await mountView();
    await flushPromises();

    await actionButton(wrapper, '新建')?.trigger('click');
    wrapper
      .findComponent({ name: 'HomepageDraftCreateDialog' })
      .vm.$emit('submit', { name: '不应创建', mode: 'COPY' });
    await flushPromises();

    expect(mocks.draftsCreate).not.toHaveBeenCalled();
    expect(mocks.editorLoad).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['COPY', { name: '复制方案', mode: 'COPY' }],
    ['BLANK', { name: '空白方案', mode: 'BLANK' }],
  ] as const)(
    'creates a %s draft and loads its selected detail',
    async (_, form) => {
      const wrapper = await mountView();
      await flushPromises();
      mocks.editorLoad.mockClear();

      await actionButton(wrapper, '新建')?.trigger('click');
      wrapper
        .findComponent({ name: 'HomepageDraftCreateDialog' })
        .vm.$emit('submit', form);
      await flushPromises();

      expect(mocks.draftsCreate).toHaveBeenCalledWith(form);
      expect(mocks.editorLoad).toHaveBeenCalledWith('99');
    },
  );

  it.each([false, true])(
    'reconciles a renamed current draft while dirty is %s',
    async (dirty) => {
      mocks.dirtyRef!.value = dirty;
      const renamed = detail('12', {
        name: '新名称',
        status: HomepageDraftStatus.PUBLISHED_WITH_CHANGES,
        version: 4,
        updatedAt: '2026-08-01T03:00:00.000Z',
      });
      mocks.draftsRename.mockResolvedValueOnce(renamed);
      const wrapper = await mountView();
      await flushPromises();
      mocks.editorLoad.mockClear();

      await draftRow(wrapper, '12')
        .find('[data-action="rename"]')
        .trigger('click');
      await flushPromises();

      expect(mocks.editorReconcileMetadata).toHaveBeenCalledWith(renamed);
      expect(mocks.editorLoad).not.toHaveBeenCalled();
      expect(mocks.draftsSelect).not.toHaveBeenCalled();
    },
  );

  it('renames a non-active draft without switching or reloading the editor', async () => {
    const wrapper = await mountView();
    await flushPromises();
    mocks.editorLoad.mockClear();

    await draftRow(wrapper, '13')
      .find('[data-action="rename"]')
      .trigger('click');
    await flushPromises();

    expect(mocks.draftsRename).toHaveBeenCalledWith('13', '新名称');
    expect(mocks.editorLoad).not.toHaveBeenCalled();
    expect(mocks.draftsSelect).not.toHaveBeenCalled();
  });

  it('loads the adjacent selected draft after removing the active draft', async () => {
    const wrapper = await mountView();
    await flushPromises();
    mocks.editorLoad.mockClear();

    await draftRow(wrapper, '12')
      .find('[data-action="remove"]')
      .trigger('click');
    await flushPromises();

    expect(mocks.draftsRemove).toHaveBeenCalledWith('12');
    expect(mocks.editorLoad).toHaveBeenCalledWith('13');
  });

  it('does not send remove for a published-source draft', async () => {
    const wrapper = await mountView();
    const remove = draftRow(wrapper, '14').find('[data-action="remove"]');

    expect(remove.attributes('disabled')).toBeDefined();
    await remove.trigger('click');

    expect(mocks.draftsRemove).not.toHaveBeenCalled();
  });

  it('opens the create dialog from an empty list state', async () => {
    mocks.activeIdRef!.value = null;
    const wrapper = await mountView();
    await flushPromises();

    expect(wrapper.text()).toContain('还没有首页草稿，请先创建草稿');
    await actionButton(wrapper, '创建第一个草稿')?.trigger('click');

    expect(
      wrapper
        .findComponent({ name: 'HomepageDraftCreateDialog' })
        .props('visible'),
    ).toBe(true);
  });

  it('loads page one with the active draft preferred after saving from page two', async () => {
    const wrapper = await mountView();
    await flushPromises();
    mocks.draftsPageRef!.value = 2;

    await actionButton(wrapper, '保存草稿')?.trigger('click');
    await flushPromises();

    expect(mocks.draftsLoad).toHaveBeenLastCalledWith(
      { page: 1, pageSize: 20 },
      '12',
    );
    expect(mocks.activeIdRef!.value).toBe('12');
    expect(wrapper.findComponent({ name: 'HomepageEditorForm' }).exists()).toBe(
      true,
    );
    expect(mocks.success).toHaveBeenCalledWith('首页草稿已保存');
  });

  it('refreshes page two with the active draft preferred after publishing', async () => {
    const wrapper = await mountView();
    await flushPromises();
    mocks.draftsPageRef!.value = 2;

    await actionButton(wrapper, '发布到 H5')?.trigger('click');
    await flushPromises();

    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.draftsLoad).toHaveBeenLastCalledWith(
      { page: 2, pageSize: 20 },
      '12',
    );
    expect(mocks.draftsSelect).not.toHaveBeenCalled();
    expect(mocks.activeIdRef!.value).toBe('12');
    expect(wrapper.findComponent({ name: 'HomepageEditorForm' }).exists()).toBe(
      true,
    );
  });

  it('reloads only the current editor detail when resolving a conflict', async () => {
    mocks.conflictRef!.value = '服务器草稿已更新';
    const wrapper = await mountView();
    await flushPromises();
    mocks.editorLoad.mockClear();
    mocks.draftsLoad.mockClear();

    await actionButton(wrapper, '重新加载服务器草稿')?.trigger('click');
    await flushPromises();

    expect(mocks.editorLoad).toHaveBeenCalledWith('12');
    expect(mocks.draftsLoad).not.toHaveBeenCalled();
  });

  it('reports a current draft-list failure without editor controls', async () => {
    mocks.activeIdRef!.value = null;
    mocks.draftsLoad.mockImplementation(async () => {
      mocks.draftsErrorRef!.value = '首页草稿列表加载失败';
      return true;
    });

    const wrapper = await mountView();
    await flushPromises();

    expect(mocks.editorLoad).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('首页草稿列表加载失败');
    expect(wrapper.text()).toContain('首页草稿列表加载失败');
    expect(wrapper.findComponent({ name: 'HomepageEditorForm' }).exists()).toBe(
      false,
    );
    expect(wrapper.find('.homepage-publish-bar').exists()).toBe(false);
  });

  it('does not show reload success when the current detail fails to reload', async () => {
    mocks.conflictRef!.value = '服务器草稿已更新';
    const wrapper = await mountView();
    await flushPromises();
    mocks.success.mockClear();
    mocks.editorLoad.mockRejectedValueOnce(new Error('详情加载失败'));

    await actionButton(wrapper, '重新加载服务器草稿')?.trigger('click');
    await flushPromises();

    expect(mocks.error).toHaveBeenCalledWith('详情加载失败');
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('does not show explicit save success or refresh when save returns false', async () => {
    mocks.saveDraft.mockResolvedValueOnce(false);
    const wrapper = await mountView();
    await flushPromises();

    await actionButton(wrapper, '保存草稿')?.trigger('click');
    await flushPromises();

    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.draftsRefresh).not.toHaveBeenCalled();
  });

  it('prevents browser unload only while the editor is dirty', async () => {
    const wrapper = await mountView();
    await flushPromises();
    const cleanEvent = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(cleanEvent);

    expect(cleanEvent.defaultPrevented).toBe(false);

    mocks.dirtyRef!.value = true;
    const dirtyEvent = new Event('beforeunload', {
      cancelable: true,
    }) as BeforeUnloadEvent;
    window.dispatchEvent(dirtyEvent);

    expect(dirtyEvent.defaultPrevented).toBe(true);
    expect(dirtyEvent.returnValue).toBe(false);
    wrapper.unmount();
  });

  it('allows route leave without confirmation when the editor is clean', async () => {
    await mountView();
    await flushPromises();

    await expect(mocks.routeLeaveGuard!()).resolves.toBe(true);

    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('allows route leave when dirty confirmation is accepted', async () => {
    mocks.dirtyRef!.value = true;
    await mountView();
    await flushPromises();

    await expect(mocks.routeLeaveGuard!()).resolves.toBe(true);

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining('尚未保存'),
      '离开编辑页面',
      expect.objectContaining({
        confirmButtonText: '离开',
        cancelButtonText: '继续编辑',
      }),
    );
  });

  it('blocks route leave when dirty confirmation is rejected', async () => {
    mocks.dirtyRef!.value = true;
    mocks.confirm.mockRejectedValueOnce('cancel');
    await mountView();
    await flushPromises();

    await expect(mocks.routeLeaveGuard!()).resolves.toBe(false);
  });

  it('does not show publish success or refresh for a stale publish result', async () => {
    mocks.publish.mockResolvedValueOnce(false);
    const wrapper = await mountView();
    await flushPromises();

    await actionButton(wrapper, '发布到 H5')?.trigger('click');
    await flushPromises();

    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.draftsRefresh).not.toHaveBeenCalled();
  });
});
