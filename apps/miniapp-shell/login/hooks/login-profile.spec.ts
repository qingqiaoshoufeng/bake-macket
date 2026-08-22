import type {
  CustomerAuthSessionView,
  CustomerAvatarPresignResponse,
  CustomerProfileView,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createWechatLoginProfileController } from './login-profile.js';

const incompleteSession = {
  accessToken: 'native-customer-token',
  expiresAt: '2026-08-19T12:00:00.000Z',
  profile: {
    id: '42',
    nickname: '微信顾客',
    avatarUrl: undefined,
    phoneVerified: false,
    profileCompleted: false,
    orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
  },
} satisfies CustomerAuthSessionView;

const completeSession = {
  ...incompleteSession,
  profile: { ...incompleteSession.profile, profileCompleted: true },
} satisfies CustomerAuthSessionView;

const updatedProfile = {
  id: '42',
  nickname: '新昵称',
  avatarUrl: null,
  phone: null,
  phoneVerified: false,
  profileCompleted: true,
  orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
} satisfies CustomerProfileView;

const presign = {
  objectKey: 'users/42/avatars/avatar.png',
  uploadUrl: 'https://objects.example.com/bake-mall',
  fields: { key: 'users/42/avatars/avatar.png' },
  expiresAt: '2026-08-19T12:05:00.000Z',
} satisfies CustomerAvatarPresignResponse;

function createSubject(
  authenticate = vi.fn(() => Promise.resolve(incompleteSession)),
  requestFreshCode = vi.fn(() => Promise.resolve('final-code')),
) {
  const applyCustomerSession = vi.fn();
  const inspectAvatar = vi.fn(() =>
    Promise.resolve({
      contentType: 'image/png' as const,
      fileName: 'avatar.png',
      filePath: 'wxfile://avatar.png',
      sizeBytes: 1024,
    }),
  );
  const navigateBack = vi.fn();
  const onStateChange = vi.fn();
  const presignAvatar = vi.fn(() => Promise.resolve(presign));
  const updateProfile = vi.fn(() => Promise.resolve(updatedProfile));
  const uploadAvatar = vi.fn(() => Promise.resolve());
  const writeHandoff = vi.fn(() => true);
  const controller = createWechatLoginProfileController({
    applyCustomerSession,
    authenticate,
    inspectAvatar,
    navigateBack,
    onStateChange,
    presignAvatar,
    requestFreshCode,
    returnUrl: 'https://mall.example.com/login',
    state: 'state-1',
    updateProfile,
    uploadAvatar,
    writeHandoff,
  });
  return {
    applyCustomerSession,
    authenticate,
    controller,
    navigateBack,
    onStateChange,
    requestFreshCode,
    updateProfile,
    writeHandoff,
  };
}

describe('WeChat login profile controller', () => {
  it('exchanges the first code into memory and stops on the profile form when incomplete', async () => {
    const subject = createSubject();

    await expect(subject.controller.start()).resolves.toBe(false);

    expect(subject.authenticate).toHaveBeenCalledOnce();
    expect(subject.applyCustomerSession).toHaveBeenCalledWith(
      incompleteSession,
    );
    expect(subject.requestFreshCode).not.toHaveBeenCalled();
    expect(subject.writeHandoff).not.toHaveBeenCalled();
    expect(subject.controller.snapshot()).toMatchObject({
      nickname: '微信顾客',
      stage: 'editing',
    });
  });

  it('uses a new code for H5 only after saving the profile', async () => {
    const subject = createSubject();
    await subject.controller.start();
    subject.controller.setNickname('新昵称');

    await expect(subject.controller.save()).resolves.toBe(true);

    expect(subject.updateProfile).toHaveBeenCalledWith({ nickname: '新昵称' });
    expect(subject.requestFreshCode).toHaveBeenCalledOnce();
    expect(subject.writeHandoff).toHaveBeenCalledWith({
      code: 'final-code',
      returnUrl: 'https://mall.example.com/login',
      state: 'state-1',
    });
    expect(subject.navigateBack).toHaveBeenCalledOnce();
  });

  it('skips profile editing but still requests a fresh final code', async () => {
    const subject = createSubject();
    await subject.controller.start();

    await expect(subject.controller.skip()).resolves.toBe(true);

    expect(subject.updateProfile).not.toHaveBeenCalled();
    expect(subject.requestFreshCode).toHaveBeenCalledOnce();
    expect(subject.writeHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'final-code' }),
    );
  });

  it('immediately finalizes a complete profile with a code different from the exchanged one', async () => {
    const authenticate = vi.fn(() => Promise.resolve(completeSession));
    const subject = createSubject(authenticate);

    await expect(subject.controller.start()).resolves.toBe(true);

    expect(authenticate).toHaveBeenCalledOnce();
    expect(subject.requestFreshCode).toHaveBeenCalledOnce();
    expect(subject.writeHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'final-code' }),
    );
  });

  it('can retry a final-code failure without authenticating or patching again', async () => {
    const requestFreshCode = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('wx.login failed'))
      .mockResolvedValueOnce('retry-final-code');
    const subject = createSubject(undefined, requestFreshCode);
    await subject.controller.start();
    subject.controller.setNickname('新昵称');

    await expect(subject.controller.save()).resolves.toBe(false);
    await expect(subject.controller.save()).resolves.toBe(true);

    expect(subject.authenticate).toHaveBeenCalledOnce();
    expect(subject.updateProfile).toHaveBeenCalledOnce();
    expect(requestFreshCode).toHaveBeenCalledTimes(2);
    expect(subject.writeHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'retry-final-code' }),
    );
  });

  it('returns to the login action after initial authentication failure and can retry', async () => {
    const authenticate = vi
      .fn<() => Promise<CustomerAuthSessionView>>()
      .mockRejectedValueOnce(new Error('exchange failed'))
      .mockResolvedValueOnce(incompleteSession);
    const subject = createSubject(authenticate);

    await expect(subject.controller.start()).resolves.toBe(false);
    expect(subject.controller.snapshot()).toMatchObject({
      error: 'exchange failed',
      stage: 'ready',
    });
    await expect(subject.controller.start()).resolves.toBe(false);

    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(subject.controller.snapshot().stage).toBe('editing');
  });
});
