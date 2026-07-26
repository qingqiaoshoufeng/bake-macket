import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { JWT_USER_AUDIENCE } from './auth.constants.js';
import { JwtUserGuard } from './user-jwt.guard.js';

const createContext = (): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: 'Bearer valid-token' } }),
    }),
  }) as ExecutionContext;

describe('JwtUserGuard', () => {
  it('rejects a valid token when its user no longer exists', async () => {
    const jwt = {
      verifyAsync: vi.fn().mockResolvedValue({
        sub: '3',
        aud: JWT_USER_AUDIENCE,
        phone: '13800000000',
      }),
    };
    const config = {
      get: vi.fn().mockReturnValue({ JWT_USER_SECRET: 'user-secret' }),
    };
    const users = { findOneBy: vi.fn().mockResolvedValue(null) };
    const guard = new JwtUserGuard(
      jwt as never,
      config as never,
      users as never,
    );

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(users.findOneBy).toHaveBeenCalledWith({ id: '3' });
  });
});
