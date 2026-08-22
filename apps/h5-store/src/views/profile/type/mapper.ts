import type {
  CustomerProfileView,
  UserProfileView,
} from '@bake-mall/contracts';

export function mapProfile(view: CustomerProfileView): UserProfileView {
  return {
    id: view.id,
    nickname: view.nickname ?? undefined,
    avatarUrl: view.avatarUrl ?? undefined,
    phone: view.phone ?? undefined,
    phoneVerified: view.phoneVerified,
    profileCompleted: view.profileCompleted,
    orderContactPhone: view.orderContactPhone,
  };
}
