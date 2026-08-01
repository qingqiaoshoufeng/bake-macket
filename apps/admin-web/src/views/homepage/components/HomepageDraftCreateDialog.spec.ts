import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import HomepageDraftCreateDialog from './HomepageDraftCreateDialog.vue';

const dialogStub = {
  props: ['modelValue'],
  emits: ['close'],
  template: '<section v-if="modelValue"><slot/><slot name="footer"/></section>',
};

function mountDialog(activeDraftId: string | null = '12') {
  return mount(HomepageDraftCreateDialog, {
    props: {
      visible: true,
      activeDraftId,
      submitting: false,
    },
    global: {
      stubs: { ElDialog: dialogStub },
    },
  });
}

describe('HomepageDraftCreateDialog', () => {
  it.each([
    ['复制当前草稿', 'COPY', { name: '中秋方案', mode: 'COPY' }],
    ['创建空白草稿', 'BLANK', { name: '中秋方案', mode: 'BLANK' }],
  ] as const)(
    'submits a trimmed valid name in %s mode',
    async (_, mode, form) => {
      const wrapper = mountDialog();
      await wrapper.find('[data-field="name"] input').setValue('  中秋方案  ');
      await wrapper.find(`[data-mode="${mode}"]`).trigger('click');
      await wrapper.find('[data-action="submit"]').trigger('click');

      expect(wrapper.emitted('submit')).toEqual([[form]]);
    },
  );

  it.each([
    ['', '请输入草稿名称'],
    [' '.repeat(2), '请输入草稿名称'],
    ['a'.repeat(121), '草稿名称不能超过 120 个字符'],
  ])('rejects invalid name %j', async (name, error) => {
    const wrapper = mountDialog();
    await wrapper.find('[data-field="name"] input').setValue(name);
    await wrapper.find('[data-action="submit"]').trigger('click');

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain(error);
  });

  it('disables COPY without a current draft and emits cancel as a controlled dialog', async () => {
    const wrapper = mountDialog(null);

    expect(
      wrapper.find('[data-mode="COPY"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.find('[data-action="cancel"]').trigger('click');

    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });
});
