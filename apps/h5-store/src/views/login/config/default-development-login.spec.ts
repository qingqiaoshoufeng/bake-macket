import { describe, expect, it } from 'vitest';

import { DEVELOPMENT_LOGIN_HINT } from '../../../bridge/miniapp.js';
import { getDefaultDevelopmentLogin } from './default-development-login.js';

describe('getDefaultDevelopmentLogin', () => {
  it('returns the shared hint in development', () => {
    expect(getDefaultDevelopmentLogin(true)).toEqual(DEVELOPMENT_LOGIN_HINT);
  });

  it('returns empty values outside development', () => {
    expect(getDefaultDevelopmentLogin(false)).toEqual({ phone: '', code: '' });
  });
});
