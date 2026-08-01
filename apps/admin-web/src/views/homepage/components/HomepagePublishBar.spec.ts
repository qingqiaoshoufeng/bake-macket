import { mount } from '@vue/test-utils';
import { ElButton } from 'element-plus';
import { describe, expect, it } from 'vitest';

import HomepagePublishBar from './HomepagePublishBar.vue';

function mountBar(overrides: Record<string, unknown> = {}) {
  return mount(HomepagePublishBar, {
    props: {
      dirty: false,
      loading: false,
      saving: false,
      publishing: false,
      canPublish: true,
      version: 3,
      ...overrides,
    },
  });
}

function saveButton(wrapper: ReturnType<typeof mountBar>) {
  return wrapper
    .findAllComponents(ElButton)
    .find((button) => button.text().includes('保存草稿'));
}

describe('HomepagePublishBar', () => {
  it.each([
    ['loading', { loading: true }],
    ['saving', { saving: true }],
    ['publishing', { publishing: true }],
  ])('disables save while %s', (_, props) => {
    const wrapper = mountBar(props);

    expect(saveButton(wrapper)?.props('disabled')).toBe(true);
  });

  it('enables save when no operation is active', () => {
    const wrapper = mountBar();

    expect(saveButton(wrapper)?.props('disabled')).toBe(false);
  });
});
