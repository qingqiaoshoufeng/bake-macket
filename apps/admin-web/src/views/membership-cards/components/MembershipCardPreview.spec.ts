import { MembershipTheme } from '@bake-mall/contracts';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import MembershipCardPreview from './MembershipCardPreview.vue';

const baseProps = {
  name: '香槟年卡',
  subtitle: '把日常烤得更香',
  badgeText: 'BAKER CLUB',
  discountText: '9.5',
  priceYuan: '199.00',
  grantCreditYuan: '300.00',
  validDays: 365,
};

describe('MembershipCardPreview', () => {
  it.each(Object.values(MembershipTheme))(
    '使用共享主题 %s 输出可识别的配方卡预览',
    (theme) => {
      const wrapper = mount(MembershipCardPreview, {
        props: { ...baseProps, theme },
      });

      expect(wrapper.attributes('data-theme')).toBe(theme);
      expect(wrapper.attributes('aria-label')).toContain('香槟年卡');
      expect(wrapper.text()).toContain('9.5 折');
      expect(wrapper.text()).toContain('赠 ¥300.00');
      expect(wrapper.get('[data-testid="recipe-stamp"]').text()).toContain(
        '365 DAYS',
      );
    },
  );
});
