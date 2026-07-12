export type AuthSessionView = {
  accessToken: string;
  expiresAt: string;
};

export type UserProfileView = {
  id: string;
  nickname?: string;
  avatarUrl?: string;
  phone?: string;
  phoneVerified: boolean;
};
