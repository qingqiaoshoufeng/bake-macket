import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { JWT_USER_AUDIENCE } from './auth.constants.js';
import { type UserJwtPayload } from './auth.types.js';
import { JwtUserGuard } from './user-jwt.guard.js';

const persistedUser = (overrides: Record<string, unknown> = {}) => ({
  id: '3',
  phone: '13900000000',
  phoneVerified: true,
  isActive: true,
  mergedIntoUserId: null,
  tokenVersion: 7,
  ...overrides,
});

const createContext = () => {
  const request: Record<string, unknown> = {
    headers: { authorization: 'Bearer valid-token' },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
  return { context, request };
};

const buildGuard = ({
  payload = {
    sub: '3',
    aud: JWT_USER_AUDIENCE,
    phone: '13800000000',
    tokenVersion: 7,
  },
  user = persistedUser(),
  lookupError,
}: {
  payload?: UserJwtPayload;
  user?: ReturnType<typeof persistedUser> | null;
  lookupError?: Error;
} = {}) => {
  const jwt = { verifyAsync: vi.fn().mockResolvedValue(payload) };
  const config = {
    get: vi.fn().mockReturnValue({ JWT_USER_SECRET: 'user-secret' }),
  };
  const findOne = lookupError
    ? vi.fn().mockRejectedValue(lookupError)
    : vi.fn().mockResolvedValue(user);
  const users = { findOne };
  return {
    guard: new JwtUserGuard(jwt as never, config as never, users as never),
    jwt,
    users,
  };
};

const asRuntimePayload = (payload: unknown): UserJwtPayload =>
  payload as UserJwtPayload;

const expectInvalidToken = async (
  guard: JwtUserGuard,
  context: ExecutionContext,
) => {
  try {
    await guard.canActivate(context);
    throw new Error('Expected JwtUserGuard to reject the token');
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).message).toBe(
      'Invalid or expired token',
    );
    return error as UnauthorizedException;
  }
};

describe('JwtUserGuard', () => {
  it('accepts an active current-version user and trusts persisted identity fields', async () => {
    const { guard, users } = buildGuard();
    const { context, request } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(users.findOne).toHaveBeenCalledWith({ where: { id: '3' } });
    expect(request.user).toEqual({
      id: '3',
      phone: '13900000000',
      phoneVerified: true,
    });
  });

  it('uses the persisted unverified value for a placeholder principal', async () => {
    const { guard } = buildGuard({
      user: persistedUser({ phoneVerified: false }),
    });
    const { context, request } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toEqual({
      id: '3',
      phone: '13900000000',
      phoneVerified: false,
    });
  });

  it('rejects a token after the persisted token version changes', async () => {
    const { guard } = buildGuard({
      user: persistedUser({ tokenVersion: 8 }),
    });
    const { context } = createContext();

    await expectInvalidToken(guard, context);
  });

  it('rejects an inactive user', async () => {
    const { guard } = buildGuard({ user: persistedUser({ isActive: false }) });
    const { context } = createContext();

    await expectInvalidToken(guard, context);
  });

  it('rejects a user merged into another account', async () => {
    const { guard } = buildGuard({
      user: persistedUser({ mergedIntoUserId: '9' }),
    });
    const { context } = createContext();

    await expectInvalidToken(guard, context);
  });

  it('rejects a valid token when its user no longer exists', async () => {
    const { guard } = buildGuard({ user: null });
    const { context } = createContext();

    await expectInvalidToken(guard, context);
  });

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['string', '7'],
  ])('rejects a token with a %s tokenVersion', async (_label, tokenVersion) => {
    const payload: Record<string, unknown> = {
      sub: '3',
      aud: JWT_USER_AUDIENCE,
      phone: '13800000000',
    };
    if (tokenVersion !== undefined) {
      payload.tokenVersion = tokenVersion;
    }
    const { guard } = buildGuard({ payload: asRuntimePayload(payload) });
    const { context } = createContext();

    await expectInvalidToken(guard, context);
  });

  it.each([
    ['missing', {}],
    ['null', { sub: null }],
    ['undefined', { sub: undefined }],
    ['empty string', { sub: '' }],
    ['whitespace', { sub: ' ' }],
    ['number', { sub: 1 }],
    ['object', { sub: {} }],
    ['zero', { sub: '0' }],
    ['negative', { sub: '-1' }],
    ['leading plus', { sub: '+1' }],
    ['leading zero', { sub: '01' }],
    ['decimal', { sub: '1.5' }],
    ['scientific notation', { sub: '1e3' }],
    ['non-ASCII digits', { sub: '١٢٣' }],
  ])(
    'rejects a token with a %s sub before querying the database',
    async (_label, subOverride) => {
      const payload: Record<string, unknown> = {
        aud: JWT_USER_AUDIENCE,
        phone: '13800000000',
        tokenVersion: 7,
        ...subOverride,
      };
      const { guard, jwt, users } = buildGuard({
        payload: asRuntimePayload(payload),
      });
      const { context } = createContext();

      await expectInvalidToken(guard, context);

      expect(jwt.verifyAsync).toHaveBeenCalledOnce();
      expect(users.findOne).not.toHaveBeenCalled();
    },
  );

  it('allows a canonical user ID larger than Number.MAX_SAFE_INTEGER without coercion', async () => {
    const userId = '18446744073709551615';
    const { guard, users } = buildGuard({
      payload: {
        sub: userId,
        aud: JWT_USER_AUDIENCE,
        phone: '13800000000',
        tokenVersion: 7,
      },
      user: persistedUser({ id: userId }),
    });
    const { context, request } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(users.findOne).toHaveBeenCalledWith({ where: { id: userId } });
    expect(request.user).toEqual({
      id: userId,
      phone: '13900000000',
      phoneVerified: true,
    });
  });

  it('normalizes repository lookup failures to 401 without exposing details', async () => {
    const lookupError = new Error('mysql connection credentials leaked');
    const { guard } = buildGuard({ lookupError });
    const { context } = createContext();

    const error = await expectInvalidToken(guard, context);

    expect(error.cause).toBe(lookupError);
    expect(error.getResponse()).not.toContain('mysql');
  });

  it('rejects a wrong-audience token before querying the database', async () => {
    const { guard, users } = buildGuard({
      payload: asRuntimePayload({
        sub: '42',
        aud: 'mall-admin',
        phone: null,
        tokenVersion: 7,
      }),
    });
    const { context } = createContext();

    await expectInvalidToken(guard, context);
    expect(users.findOne).not.toHaveBeenCalled();
  });
});
