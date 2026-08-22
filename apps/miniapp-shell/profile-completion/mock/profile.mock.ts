import type { CustomerAuthSessionView } from '@bake-mall/contracts';

export const profileCompletionMockSession = Object.freeze({
  accessToken: 'profile-completion-mock-token',
  expiresAt: '2026-08-18T12:00:00.000Z',
  profile: {
    id: 'profile-completion-mock-user',
    nickname: '烘焙新朋友',
    phoneVerified: false,
    profileCompleted: false,
    orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
  },
} satisfies CustomerAuthSessionView);
