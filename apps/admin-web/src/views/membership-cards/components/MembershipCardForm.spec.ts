import { MembershipLevelStatus, MembershipTheme } from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { createMembershipCardDefaults } from '../config/defaults.js';
import MembershipCardForm from './MembershipCardForm.vue';

function mountForm(editing = false) {
  return mount(MembershipCardForm, {
    props: {
      form: {
        ...createMembershipCardDefaults(),
        code: 'PEARL_90',
        name: '珍珠季卡',
        badgeText: 'FRESH BATCH',
        theme: MembershipTheme.PEARL,
        status: MembershipLevelStatus.INACTIVE,
      },
      editing,
      saving: false,
    },
  });
}

describe('MembershipCardForm', () => {
  it('编辑时锁定 code 并明确区分 rank 与 sortOrder', () => {
    const wrapper = mountForm(true);

    expect(
      wrapper.get('[data-testid="membership-code"]').attributes(),
    ).toHaveProperty('disabled');
    expect(wrapper.text()).toContain('业务等级 rank');
    expect(wrapper.text()).toContain('展示排序 sortOrder');
  });

  it('从共享 MembershipTheme 渲染四个主题并实时显示同一预览组件', () => {
    const wrapper = mountForm();

    expect(wrapper.findAll('[data-testid="theme-option"]')).toHaveLength(4);
    expect(
      wrapper
        .get('[data-testid="membership-card-preview"]')
        .attributes('data-theme'),
    ).toBe(MembershipTheme.PEARL);
  });

  it('不可变地添加和删除有序权益并使用主动保存文案', async () => {
    const wrapper = mountForm();
    const original = wrapper.props('form');

    await wrapper.get('[data-testid="add-benefit"]').trigger('click');
    const added = wrapper.emitted('update:form')?.at(-1)?.[0] as {
      benefits: readonly unknown[];
    };
    expect(added.benefits).toHaveLength(1);
    expect(original.benefits).toHaveLength(0);
    expect(
      wrapper.get('[data-testid="save-membership-card"]').text(),
    ).toContain('保存更改');
  });
});
