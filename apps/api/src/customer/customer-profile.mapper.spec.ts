import { describe, expect, it } from 'vitest';

import { User } from '../database/entities/user.entity.js';
import { toCustomerProfileView } from './customer-profile.mapper.js';

function user(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: '1',
    nickname: ' 蛋糕爱好者 ',
    avatarUrl: 'https://cdn.example/users/1/avatars/avatar.webp',
    avatarObjectKey: 'users/1/avatars/avatar.webp',
    phone: '13800000000',
    phoneVerified: true,
    orderContactPhone: null,
    orderContactPhoneVersion: 0,
    ...overrides,
  });
}

describe('toCustomerProfileView', () => {
  it('maps one nullable wire shape and computes completion from normalized nickname plus managed avatar', () => {
    expect(toCustomerProfileView(user())).toEqual({
      id: '1',
      nickname: '蛋糕爱好者',
      avatarUrl: 'https://cdn.example/users/1/avatars/avatar.webp',
      phone: '138****0000',
      phoneVerified: true,
      profileCompleted: true,
      orderContactPhone: {
        configured: false,
        maskedPhone: null,
        version: 0,
      },
    });
  });

  it.each([
    { nickname: '   ' },
    { avatarObjectKey: null },
    { avatarUrl: null },
  ])(
    'marks incomplete profile for $nickname $avatarObjectKey $avatarUrl',
    (overrides) => {
      expect(toCustomerProfileView(user(overrides))).toMatchObject({
        profileCompleted: false,
      });
    },
  );
});
