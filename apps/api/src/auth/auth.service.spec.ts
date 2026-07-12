import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ApiErrorCode } from '@bake-mall/contracts';

import { UserAuthService, requireVerifiedPhone } from './user-auth.service.js';

describe('requireVerifiedPhone', () => {
  it('throws ForbiddenException with PHONE_REQUIRED when phone is null', () => {
    expect(() => requireVerifiedPhone({ id: '1', phone: null })).toThrowError(
      ForbiddenException,
    );
    try {
      requireVerifiedPhone({ id: '1', phone: null });
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

  it('returns the user when phone is present', () => {
    const result = requireVerifiedPhone({
      id: '42',
      phone: '13800000000',
    });
    expect(result).toEqual({ id: '42', phone: '13800000000' });
  });
});

describe('UserAuthService.export shape', () => {
  it('exposes requireVerifiedPhone alongside the service', () => {
    expect(typeof requireVerifiedPhone).toBe('function');
    expect(UserAuthService).toBeDefined();
  });
});
