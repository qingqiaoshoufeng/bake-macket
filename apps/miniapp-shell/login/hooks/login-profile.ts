import type {
  CustomerAuthSessionView,
  CustomerProfileView,
} from '@bake-mall/contracts';

import {
  createProfileEditorController,
  profileErrorMessage,
  type ProfileEditorControllerDependencies,
} from '../../profile-completion/hooks/profile-editor.js';
import type {
  ProfileCompletionState,
  WechatLoginHandoff,
  WechatLoginProfileState,
} from '../type/index.js';

type WechatLoginProfileControllerDependencies = Omit<
  ProfileEditorControllerDependencies,
  'applyProfile' | 'onStateChange'
> &
  Readonly<{
    authenticate: () => Promise<CustomerAuthSessionView>;
    navigateBack: () => void;
    onStateChange: (state: WechatLoginProfileState) => void;
    requestFreshCode: () => Promise<unknown>;
    returnUrl: string;
    state: string;
    writeHandoff: (handoff: WechatLoginHandoff) => boolean;
  }>;

function parseCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return code || null;
}

export function createWechatLoginProfileController(
  dependencies: WechatLoginProfileControllerDependencies,
) {
  let authenticated = false;
  let profileSaved = false;
  let state: WechatLoginProfileState = {
    avatarPreviewUrl: '',
    error: null,
    nickname: '',
    stage: 'ready',
  };

  function publish(next: WechatLoginProfileState): void {
    state = next;
    dependencies.onStateChange(state);
  }

  function publishEditorState(editorState: ProfileCompletionState): void {
    publish(editorState);
  }

  function applyProfile(profile: CustomerProfileView): void {
    const current = editorSession();
    if (!current) return;
    dependencies.applyCustomerSession({
      ...current,
      profile: {
        id: profile.id,
        nickname: profile.nickname ?? undefined,
        avatarUrl: profile.avatarUrl ?? undefined,
        phone: profile.phone ?? undefined,
        phoneVerified: profile.phoneVerified,
        profileCompleted: profile.profileCompleted,
        orderContactPhone: profile.orderContactPhone,
      },
    });
  }

  let customerSession: CustomerAuthSessionView | null = null;
  function editorSession(): CustomerAuthSessionView | null {
    return customerSession;
  }

  function applyCustomerSession(session: CustomerAuthSessionView): void {
    customerSession = session;
    dependencies.applyCustomerSession(session);
  }

  const editor = createProfileEditorController({
    applyCustomerSession,
    applyProfile,
    inspectAvatar: dependencies.inspectAvatar,
    onStateChange: publishEditorState,
    presignAvatar: dependencies.presignAvatar,
    updateProfile: dependencies.updateProfile,
    uploadAvatar: dependencies.uploadAvatar,
  });

  function snapshot(): WechatLoginProfileState {
    return { ...state };
  }

  async function finalize(): Promise<boolean> {
    publish({ ...state, error: null, stage: 'finalizing' });
    try {
      const code = parseCode(await dependencies.requestFreshCode());
      const stored = code
        ? dependencies.writeHandoff({
            code,
            returnUrl: dependencies.returnUrl,
            state: dependencies.state,
          })
        : false;
      if (!stored) throw new Error('微信登录失败，请重试');
      dependencies.navigateBack();
      return true;
    } catch (error) {
      publish({
        ...state,
        error: profileErrorMessage(error, '微信登录失败，请重试'),
        stage: authenticated ? 'editing' : 'ready',
      });
      return false;
    }
  }

  async function start(): Promise<boolean> {
    if (state.stage === 'authenticating' || state.stage === 'finalizing') {
      return false;
    }
    publish({ ...state, error: null, stage: 'authenticating' });
    try {
      const session = await dependencies.authenticate();
      authenticated = true;
      editor.initializeWithSession(session);
      return session.profile.profileCompleted ? finalize() : false;
    } catch (error) {
      publish({
        ...state,
        error: profileErrorMessage(error, '微信登录失败，请重试'),
        stage: 'ready',
      });
      return false;
    }
  }

  async function save(): Promise<boolean> {
    if (!authenticated) return false;
    if (!profileSaved) {
      const profile = await editor.save();
      if (!profile) return false;
      profileSaved = true;
    }
    return finalize();
  }

  async function skip(): Promise<boolean> {
    return authenticated ? finalize() : false;
  }

  return {
    chooseAvatar: editor.chooseAvatar,
    save,
    setNickname: editor.setNickname,
    skip,
    snapshot,
    start,
  } as const;
}
