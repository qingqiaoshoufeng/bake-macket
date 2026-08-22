import type {
  CustomerAuthSessionView,
  CustomerAvatarPresignRequest,
  CustomerAvatarPresignResponse,
  CustomerProfileView,
  UpdateCustomerProfileRequest,
} from '@bake-mall/contracts';

import {
  CUSTOMER_AVATAR_CONTENT_TYPES,
  MAX_CUSTOMER_AVATAR_SIZE_BYTES,
  MAX_CUSTOMER_NICKNAME_LENGTH,
} from '../config/avatar.js';
import type {
  InspectedAvatarFile,
  ProfileCompletionState,
} from '../type/index.js';

export type ProfileEditorControllerDependencies = Readonly<{
  applyCustomerSession: (session: CustomerAuthSessionView) => void;
  applyProfile: (profile: CustomerProfileView) => void;
  inspectAvatar: (filePath: string) => Promise<InspectedAvatarFile>;
  onStateChange: (state: ProfileCompletionState) => void;
  presignAvatar: (
    body: CustomerAvatarPresignRequest,
  ) => Promise<CustomerAvatarPresignResponse>;
  updateProfile: (
    body: UpdateCustomerProfileRequest,
  ) => Promise<CustomerProfileView>;
  uploadAvatar: (
    presign: CustomerAvatarPresignResponse,
    filePath: string,
  ) => Promise<void>;
}>;

export function profileErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function validateNickname(value: string): string | null {
  const nickname = value.trim();
  if (!nickname) return '请输入昵称';
  if (Array.from(nickname).length > MAX_CUSTOMER_NICKNAME_LENGTH) {
    return '昵称不能超过 64 个字符';
  }
  const hasControl = Array.from(nickname).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  return hasControl ? '昵称不能包含控制字符' : null;
}

function validateAvatar(file: InspectedAvatarFile): string | null {
  if (
    !CUSTOMER_AVATAR_CONTENT_TYPES.some((item) => item === file.contentType)
  ) {
    return '仅支持 JPEG、PNG 或 WebP 头像';
  }
  if (file.sizeBytes < 1) return '头像文件为空';
  return file.sizeBytes > MAX_CUSTOMER_AVATAR_SIZE_BYTES
    ? '头像不能超过 5 MiB'
    : null;
}

export function createProfileEditorController(
  dependencies: ProfileEditorControllerDependencies,
) {
  let state: ProfileCompletionState = {
    avatarPreviewUrl: '',
    error: null,
    nickname: '',
    stage: 'authenticating',
  };
  let avatarFile: InspectedAvatarFile | null = null;
  let uploadedObjectKey: string | null = null;

  function updateState(patch: Partial<ProfileCompletionState>): void {
    state = { ...state, ...patch };
    dependencies.onStateChange(state);
  }

  function snapshot(): ProfileCompletionState {
    return { ...state };
  }

  function initializeWithSession(session: CustomerAuthSessionView): void {
    dependencies.applyCustomerSession(session);
    updateState({
      avatarPreviewUrl: session.profile.avatarUrl ?? '',
      error: null,
      nickname: session.profile.nickname ?? '',
      stage: 'editing',
    });
  }

  function setNickname(nickname: string): void {
    updateState({ error: null, nickname });
  }

  async function chooseAvatar(filePath: string): Promise<boolean> {
    try {
      const inspected = await dependencies.inspectAvatar(filePath);
      const validationError = validateAvatar(inspected);
      if (validationError) {
        updateState({ error: validationError });
        return false;
      }
      avatarFile = inspected;
      uploadedObjectKey = null;
      updateState({ avatarPreviewUrl: inspected.filePath, error: null });
      return true;
    } catch (error) {
      updateState({ error: profileErrorMessage(error, '无法读取头像文件') });
      return false;
    }
  }

  async function ensureUploadedAvatar(): Promise<string | null> {
    if (uploadedObjectKey) return uploadedObjectKey;
    if (!avatarFile) return null;
    updateState({ error: null, stage: 'presigning' });
    const presign = await dependencies.presignAvatar({
      contentType: avatarFile.contentType,
      fileName: avatarFile.fileName,
      sizeBytes: avatarFile.sizeBytes,
    });
    updateState({ stage: 'uploading' });
    await dependencies.uploadAvatar(presign, avatarFile.filePath);
    uploadedObjectKey = presign.objectKey;
    return uploadedObjectKey;
  }

  async function save(): Promise<CustomerProfileView | null> {
    const nickname = state.nickname.trim();
    const nicknameError = validateNickname(nickname);
    if (nicknameError) {
      updateState({ error: nicknameError, stage: 'editing' });
      return null;
    }
    try {
      const objectKey = await ensureUploadedAvatar();
      updateState({ error: null, stage: 'saving' });
      const body: UpdateCustomerProfileRequest = objectKey
        ? { nickname, avatarObjectKey: objectKey }
        : { nickname };
      const profile = await dependencies.updateProfile(body);
      dependencies.applyProfile(profile);
      updateState({ stage: 'editing' });
      return profile;
    } catch (error) {
      updateState({
        error: profileErrorMessage(error, '保存失败，请重试'),
        stage: 'editing',
      });
      return null;
    }
  }

  return {
    chooseAvatar,
    initializeWithSession,
    save,
    setNickname,
    snapshot,
  } as const;
}
