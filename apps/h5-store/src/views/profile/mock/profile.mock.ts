import type { ProfileViewModel } from '../type/index.js';

export const profileMock: Readonly<ProfileViewModel> = {
  id: 'user-demo',
  nickname: '小明',
  phone: '138****0000',
  phoneVerified: true,
  orderContactPhone: {
    configured: true,
    maskedPhone: '139****0000',
    version: 2,
  },
};

export const profileWithoutOrderContactMock: Readonly<ProfileViewModel> = {
  ...profileMock,
  orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
};
