import { describe, expect, it } from 'vitest';

import { getDefaultAdminLogin } from './default-admin-login.js';

describe('getDefaultAdminLogin', () => {
  it('returns configured credentials in development', () => {
    expect(
      getDefaultAdminLogin({
        isDevelopment: true,
        email: 'admin@example.com',
        password: 'admin-password',
      }),
    ).toEqual({
      email: 'admin@example.com',
      password: 'admin-password',
    });
  });

  it('falls back to empty values when development variables are missing', () => {
    expect(getDefaultAdminLogin({ isDevelopment: true })).toEqual({
      email: '',
      password: '',
    });
  });

  it('returns empty values outside development even when variables exist', () => {
    expect(
      getDefaultAdminLogin({
        isDevelopment: false,
        email: 'admin@example.com',
        password: 'admin-password',
      }),
    ).toEqual({ email: '', password: '' });
  });
});
