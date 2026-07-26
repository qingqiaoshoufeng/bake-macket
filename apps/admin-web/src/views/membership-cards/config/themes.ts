import { MembershipTheme } from '@bake-mall/contracts';

export type MembershipThemeToken = {
  readonly value: MembershipTheme;
  readonly label: string;
  readonly recipeName: string;
};

export const MEMBERSHIP_THEME_OPTIONS: readonly MembershipThemeToken[] = [
  {
    value: MembershipTheme.PEARL,
    label: '珍珠奶霜',
    recipeName: 'PEARL MERINGUE',
  },
  {
    value: MembershipTheme.CHAMPAGNE,
    label: '香槟焦糖',
    recipeName: 'CHAMPAGNE CARAMEL',
  },
  {
    value: MembershipTheme.JADE,
    label: '翡翠抹茶',
    recipeName: 'JADE MATCHA',
  },
  {
    value: MembershipTheme.OBSIDIAN,
    label: '曜石可可',
    recipeName: 'OBSIDIAN CACAO',
  },
];
