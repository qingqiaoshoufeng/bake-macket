import { MembershipTheme } from '@bake-mall/contracts';

export const MEMBERSHIP_THEME_CLASS = {
  [MembershipTheme.PEARL]: 'membership-card--pearl',
  [MembershipTheme.CHAMPAGNE]: 'membership-card--champagne',
  [MembershipTheme.JADE]: 'membership-card--jade',
  [MembershipTheme.OBSIDIAN]: 'membership-card--obsidian',
} as const;

export const MEMBERSHIP_COPY = {
  centerTitle: '烘焙护照',
  centerEyebrow: 'BAKE PASSPORT',
  centerDescription: '收藏每一次香甜相遇，让会员权益陪你慢慢发酵。',
  emptyTitle: '会员服务准备中',
  emptyDescription: '新的烘焙护照正在制作，请稍后再来看看。',
} as const;
