import type {
  CustomerAuthSessionView,
  CustomerAvatarPresignResponse,
  CustomerProfileView,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createProfileCompletionController } from './profile-completion.js';

const session = {
  accessToken: 'native-customer-token',
  expiresAt: '2026-08-18T12:00:00.000Z',
  profile: {
    id: '42',
    nickname: '旧昵称',
    avatarUrl: undefined,
    phoneVerified: false,
    profileCompleted: false,
    orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
  },
} satisfies CustomerAuthSessionView;

const presign = {
  objectKey: 'users/42/avatars/server-id.png',
  uploadUrl: 'https://objects.example.com/bake-mall',
  fields: { key: 'users/42/avatars/server-id.png', policy: 'secret-policy' },
  expiresAt: '2026-08-18T12:05:00.000Z',
} satisfies CustomerAvatarPresignResponse;

const updatedProfile = {
  id: '42',
  nickname: '新昵称',
  avatarUrl: 'https://objects.example.com/users/42/avatars/server-id.png',
  phone: null,
  phoneVerified: false,
  profileCompleted: true,
  orderContactPhone: { configured: false, maskedPhone: null, version: 0 },
} satisfies CustomerProfileView;

function createSubject(
  updateProfile = vi.fn(() => Promise.resolve(updatedProfile)),
) {
  const authenticate = vi.fn(() => Promise.resolve(session));
  const applyCustomerSession = vi.fn();
  const applyProfile = vi.fn();
  const inspectAvatar = vi.fn(() =>
    Promise.resolve({
      contentType: 'image/png' as const,
      fileName: 'avatar.png',
      filePath: 'wxfile://avatar.png',
      sizeBytes: 1024,
    }),
  );
  const presignAvatar = vi.fn(() => Promise.resolve(presign));
  const uploadAvatar = vi.fn(() => Promise.resolve());
  const writeOutcome = vi.fn(() => true);
  const navigateBack = vi.fn();
  const states: unknown[] = [];
  const controller = createProfileCompletionController({
    applyCustomerSession,
    applyProfile,
    authenticate,
    inspectAvatar,
    navigateBack,
    onStateChange: (state) => states.push(state),
    presignAvatar,
    returnUrl: 'https://mall.example.com/profile',
    updateProfile,
    uploadAvatar,
    writeOutcome,
  });
  return {
    applyCustomerSession,
    applyProfile,
    authenticate,
    controller,
    inspectAvatar,
    navigateBack,
    presignAvatar,
    states,
    updateProfile,
    uploadAvatar,
    writeOutcome,
  };
}

describe('profile completion controller', () => {
  it('fresh-authenticates into the native in-memory customer session and prefills profile', async () => {
    const subject = createSubject();

    await expect(subject.controller.initialize()).resolves.toBe(true);

    expect(subject.authenticate).toHaveBeenCalledOnce();
    expect(subject.applyCustomerSession).toHaveBeenCalledWith(session);
    expect(subject.controller.snapshot()).toMatchObject({
      stage: 'editing',
      nickname: '旧昵称',
      avatarPreviewUrl: '',
    });
  });

  it('validates image metadata and completes file-info → presign → upload → patch', async () => {
    const subject = createSubject();
    await subject.controller.initialize();
    subject.controller.setNickname(' 新昵称 ');

    await expect(
      subject.controller.chooseAvatar('wxfile://avatar.png'),
    ).resolves.toBe(true);
    await expect(subject.controller.save()).resolves.toBe(true);

    expect(subject.inspectAvatar).toHaveBeenCalledWith('wxfile://avatar.png');
    expect(subject.presignAvatar).toHaveBeenCalledWith({
      contentType: 'image/png',
      fileName: 'avatar.png',
      sizeBytes: 1024,
    });
    expect(subject.uploadAvatar).toHaveBeenCalledWith(
      presign,
      'wxfile://avatar.png',
    );
    expect(subject.updateProfile).toHaveBeenCalledWith({
      nickname: '新昵称',
      avatarObjectKey: presign.objectKey,
    });
    expect(subject.applyProfile).toHaveBeenCalledWith(updatedProfile);
    expect(subject.writeOutcome).toHaveBeenCalledWith({
      outcome: 'PROFILE_UPDATED',
      returnUrl: 'https://mall.example.com/profile',
    });
    expect(subject.navigateBack).toHaveBeenCalledOnce();
  });

  it('retries a failed patch with the uploaded object key without uploading again', async () => {
    const updateProfile = vi
      .fn<() => Promise<CustomerProfileView>>()
      .mockRejectedValueOnce(new Error('patch failed'))
      .mockResolvedValueOnce(updatedProfile);
    const subject = createSubject(updateProfile);
    await subject.controller.initialize();
    subject.controller.setNickname('新昵称');
    await subject.controller.chooseAvatar('wxfile://avatar.png');

    await expect(subject.controller.save()).resolves.toBe(false);
    await expect(subject.controller.save()).resolves.toBe(true);

    expect(subject.presignAvatar).toHaveBeenCalledOnce();
    expect(subject.uploadAvatar).toHaveBeenCalledOnce();
    expect(subject.updateProfile).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      {
        contentType: 'image/gif',
        fileName: 'avatar.gif',
        filePath: 'wxfile://avatar.gif',
        sizeBytes: 100,
      },
      '仅支持 JPEG、PNG 或 WebP 头像',
    ],
    [
      {
        contentType: 'image/png',
        fileName: 'avatar.png',
        filePath: 'wxfile://avatar.png',
        sizeBytes: 5 * 1024 * 1024 + 1,
      },
      '头像不能超过 5 MiB',
    ],
  ] as const)(
    'rejects invalid MIME or over-5-MiB files before presign',
    async (file, message) => {
      const subject = createSubject();
      await subject.controller.initialize();
      subject.inspectAvatar.mockResolvedValueOnce(file as never);

      await expect(
        subject.controller.chooseAvatar(file.filePath),
      ).resolves.toBe(false);

      expect(subject.controller.snapshot().error).toBe(message);
      expect(subject.presignAvatar).not.toHaveBeenCalled();
    },
  );

  it('allows explicit skip and system return once without upload or patch', async () => {
    const explicit = createSubject();
    await explicit.controller.initialize();
    expect(explicit.controller.skip()).toBe(true);
    expect(explicit.controller.handleSystemReturn()).toBe(false);

    expect(explicit.writeOutcome).toHaveBeenCalledOnce();
    expect(explicit.writeOutcome).toHaveBeenCalledWith({
      outcome: 'PROFILE_SKIPPED',
      returnUrl: 'https://mall.example.com/profile',
    });
    expect(explicit.presignAvatar).not.toHaveBeenCalled();
    expect(explicit.updateProfile).not.toHaveBeenCalled();

    const system = createSubject();
    await system.controller.initialize();
    expect(system.controller.handleSystemReturn()).toBe(true);
    expect(system.controller.handleSystemReturn()).toBe(false);
    expect(system.writeOutcome).toHaveBeenCalledOnce();
    expect(system.navigateBack).not.toHaveBeenCalled();
  });
});
