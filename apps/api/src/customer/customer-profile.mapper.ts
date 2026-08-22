import type {
  CustomerProfileView,
  UserProfileView,
} from '@bake-mall/contracts';

import type { User } from '../database/entities/user.entity.js';
import { toOrderContactPhoneView } from './order-contact-phone.service.js';

export const normalizeCustomerNickname = (
  nickname: string | null,
): string | null => nickname?.trim() || null;

export const maskCustomerPhone = (phone: string | null): string | null => {
  if (!phone) return null;
  if (phone.length < 7) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
};

const profileShape = (user: User) => {
  const nickname = normalizeCustomerNickname(user.nickname);
  const managedAvatar = Boolean(
    user.avatarObjectKey && user.avatarUrl && user.avatarUrl.startsWith('http'),
  );
  return {
    id: user.id,
    nickname,
    avatarUrl: user.avatarUrl,
    phone: maskCustomerPhone(user.phone),
    phoneVerified: user.phoneVerified,
    profileCompleted: Boolean(nickname && managedAvatar),
    orderContactPhone: toOrderContactPhoneView(
      user.orderContactPhone,
      user.orderContactPhoneVersion,
    ),
  };
};

export const toCustomerProfileView = (user: User): CustomerProfileView =>
  profileShape(user);

export const toUserProfileView = (user: User): UserProfileView => {
  const profile = profileShape(user);
  return {
    ...profile,
    nickname: profile.nickname ?? undefined,
    avatarUrl: profile.avatarUrl ?? undefined,
    phone: profile.phone ?? undefined,
  };
};
