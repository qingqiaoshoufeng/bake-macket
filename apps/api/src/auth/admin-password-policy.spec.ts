import { ApiErrorCode } from '@bake-mall/contracts';
import { describe, expect, it } from 'vitest';

import { validateAdminPassword } from './admin-password-policy.js';

describe('validateAdminPassword', () => {
  it.each(['123456', '1234567', '12345678901234567890'])(
    '接受至少六位 ASCII 数字：%s',
    (password) => {
      expect(validateAdminPassword(password)).toEqual({ ok: true });
    },
  );

  it.each([
    '',
    '12345',
    '１２３４５６',
    '12345a',
    ' 123456',
    '123456 ',
    '123 456',
  ])('拒绝空值、短值、非 ASCII 数字和任何空格：%s', (password) => {
    expect(validateAdminPassword(password)).toEqual({
      ok: false,
      code: ApiErrorCode.ADMIN_PASSWORD_POLICY_VIOLATION,
    });
  });
});
