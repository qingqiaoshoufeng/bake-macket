import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ApiErrorCode } from '@bake-mall/contracts';

import { JWT_USER_AUDIENCE } from './auth.constants.js';
import { UserAuthService, requireVerifiedPhone } from './user-auth.service.js';

describe('requireVerifiedPhone', () => {
  it('throws ForbiddenException with PHONE_REQUIRED when phone is null', () => {
    expect(() =>
      requireVerifiedPhone({ id: '1', phone: null, phoneVerified: false }),
    ).toThrowError(ForbiddenException);
    try {
      requireVerifiedPhone({ id: '1', phone: null, phoneVerified: false });
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as {
        code: ApiErrorCode;
        message: string;
      };
      expect(response.code).toBe(ApiErrorCode.PHONE_REQUIRED);
      expect(response.message).toMatch(/verified phone/i);
    }
  });

  it('throws PHONE_REQUIRED when a placeholder phone is not verified', () => {
    expect(() =>
      requireVerifiedPhone({
        id: '42',
        phone: '13800000000',
        phoneVerified: false,
      }),
    ).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({
          code: ApiErrorCode.PHONE_REQUIRED,
        }),
      }),
    );
  });

  it('returns only a non-empty verified phone principal', () => {
    const result = requireVerifiedPhone({
      id: '42',
      phone: '13800000000',
      phoneVerified: true,
    });
    expect(result).toEqual({
      id: '42',
      phone: '13800000000',
      phoneVerified: true,
    });
  });
});

describe('UserAuthService session signing', () => {
  it.each([
    ['1', 1],
    ['2', 9],
  ])(
    'signs the persisted tokenVersion for user %s',
    async (userId, tokenVersion) => {
      const sign = vi.fn().mockReturnValue(`token-${userId}`);
      const jwt = { sign };
      const config = {
        get: vi.fn().mockReturnValue({
          NODE_ENV: 'development',
          JWT_USER_SECRET: 'user-secret',
          JWT_EXPIRES_IN_SECONDS: 3600,
        }),
      };
      const persistedUser = {
        id: userId,
        phone: `1380000000${userId}`,
        phoneVerified: true,
        isActive: true,
        mergedIntoUserId: null,
        tokenVersion,
      };
      const users = {
        findOne: vi.fn().mockResolvedValue(persistedUser),
      };
      const service = new UserAuthService(
        jwt as never,
        config as never,
        users as never,
        { mergeVerifiedPhone: vi.fn() } as never,
      );

      await service.loginWithDevelopmentCode(persistedUser.phone, '123456');

      expect(sign).toHaveBeenCalledWith(
        {
          sub: userId,
          aud: JWT_USER_AUDIENCE,
          phone: persistedUser.phone,
          tokenVersion,
        },
        {
          secret: 'user-secret',
          expiresIn: 3600,
        },
      );
    },
  );
});

describe('UserAuthService development login identity writes', () => {
  it('新手机号先创建无手机号 source，再经 merge 验证且不消费 WeChat credential', async () => {
    const source = {
      id: '20',
      phone: null,
      phoneVerified: false,
      isActive: true,
      mergedIntoUserId: null,
      tokenVersion: 1,
    };
    const canonical = { ...source, phone: '13800000000', phoneVerified: true };
    const users = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockReturnValue(source),
      save: vi.fn().mockResolvedValue(source),
    };
    const mergeVerifiedPhone = vi.fn().mockResolvedValue({
      userId: canonical.id,
      user: canonical,
      migrated: { addresses: 0, cartItems: 0 },
      operatorChanged: false,
    });
    const service = new UserAuthService(
      { sign: vi.fn().mockReturnValue('new-token') } as never,
      {
        get: vi.fn().mockReturnValue({
          NODE_ENV: 'development',
          JWT_USER_SECRET: 'user-secret',
          JWT_EXPIRES_IN_SECONDS: 3600,
        }),
      } as never,
      users as never,
      { mergeVerifiedPhone } as never,
    );

    await service.loginWithDevelopmentCode('13800000000', '123456');

    expect(users.create).toHaveBeenCalledWith({
      nickname: null,
      avatarUrl: null,
      wechatOpenid: null,
      wechatUnionid: null,
    });
    expect(mergeVerifiedPhone).toHaveBeenCalledWith({
      authenticatedUserId: source.id,
      normalizedPhone: '13800000000',
    });
  });
});

describe('UserAuthService phone binding', () => {
  it('委托 identity merge 并为 canonical user 返回完整新 session', async () => {
    const canonical = {
      id: '10',
      phone: '13800000000',
      phoneVerified: true,
      isActive: true,
      mergedIntoUserId: null,
      tokenVersion: 7,
    };
    const mergeVerifiedPhone = vi.fn().mockResolvedValue({
      userId: canonical.id,
      user: canonical,
      migrated: { addresses: 1, cartItems: 2 },
      operatorChanged: false,
    });
    const sign = vi.fn().mockReturnValue('canonical-token');
    const service = new UserAuthService(
      { sign } as never,
      {
        get: vi.fn().mockReturnValue({
          NODE_ENV: 'development',
          JWT_USER_SECRET: 'user-secret',
          JWT_EXPIRES_IN_SECONDS: 3600,
        }),
      } as never,
      {} as never,
      { mergeVerifiedPhone } as never,
    );

    const result = await service.bindPhone(
      { id: '20', phone: null },
      canonical.phone,
      '123456',
    );

    expect(mergeVerifiedPhone).toHaveBeenCalledWith({
      authenticatedUserId: '20',
      normalizedPhone: canonical.phone,
    });
    expect(result).toEqual({
      accessToken: 'canonical-token',
      expiresAt: expect.any(String),
    });
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: '10', tokenVersion: 7 }),
      expect.any(Object),
    );
  });
});

describe('UserAuthService.export shape', () => {
  it('exposes requireVerifiedPhone alongside the service', () => {
    expect(typeof requireVerifiedPhone).toBe('function');
    expect(UserAuthService).toBeDefined();
  });
});
