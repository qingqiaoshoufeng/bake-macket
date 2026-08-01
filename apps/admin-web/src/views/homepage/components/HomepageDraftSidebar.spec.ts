import { HomepageDraftStatus } from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import HomepageDraftSidebar from './HomepageDraftSidebar.vue';

const timestamps = {
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
};

const items = [
  {
    id: 'published',
    name: '线上首页',
    status: HomepageDraftStatus.PUBLISHED,
    version: 5,
    ...timestamps,
  },
  {
    id: 'changed',
    name: '线上改版',
    status: HomepageDraftStatus.PUBLISHED_WITH_CHANGES,
    version: 6,
    ...timestamps,
  },
  {
    id: 'draft',
    name: '节日草稿',
    status: HomepageDraftStatus.DRAFT,
    version: 2,
    ...timestamps,
  },
] as const;

function mountSidebar() {
  return mount(HomepageDraftSidebar, {
    props: {
      items,
      activeId: 'draft',
      loading: false,
      page: 1,
      pageSize: 20,
      total: 21,
    },
  });
}

describe('HomepageDraftSidebar', () => {
  it('shows draft names, timestamps, and the three business status labels', () => {
    const wrapper = mountSidebar();

    expect(wrapper.text()).toContain('线上首页');
    expect(wrapper.text()).toContain('2026-08-01');
    expect(wrapper.text()).toContain('线上版本');
    expect(wrapper.text()).toContain('线上来源·有未发布修改');
    expect(wrapper.text()).toContain('普通草稿');
    expect(wrapper.find('[data-draft-id="draft"]').classes()).toContain(
      'homepage-draft-sidebar__item--active',
    );
  });

  it('disables removal for both published-source statuses with an explanation', async () => {
    const wrapper = mountSidebar();
    const publishedRemove = wrapper.find(
      '[data-draft-id="published"] [data-action="remove"]',
    );
    const changedRemove = wrapper.find(
      '[data-draft-id="changed"] [data-action="remove"]',
    );
    const draftRemove = wrapper.find(
      '[data-draft-id="draft"] [data-action="remove"]',
    );

    expect(publishedRemove.attributes('disabled')).toBeDefined();
    expect(changedRemove.attributes('disabled')).toBeDefined();
    expect(publishedRemove.attributes('title')).toContain(
      '线上来源草稿不能删除',
    );
    expect(changedRemove.attributes('title')).toContain('线上来源草稿不能删除');

    await publishedRemove.trigger('click');
    await changedRemove.trigger('click');
    await draftRemove.trigger('click');

    expect(wrapper.emitted('remove')).toEqual([[items[2]]]);
  });

  it('emits selection, creation, rename, and page changes without business side effects', async () => {
    const wrapper = mountSidebar();

    await wrapper.find('[data-draft-id="published"]').trigger('click');
    await wrapper.find('[data-action="create"]').trigger('click');
    await wrapper
      .find('[data-draft-id="draft"] [data-action="rename"]')
      .trigger('click');
    wrapper
      .findComponent({ name: 'ElPagination' })
      .vm.$emit('current-change', 2);

    expect(wrapper.emitted('select')).toEqual([['published']]);
    expect(wrapper.emitted('create')).toHaveLength(1);
    expect(wrapper.emitted('rename')).toEqual([[items[2]]]);
    expect(wrapper.emitted('page-change')).toEqual([[2]]);
  });
});
