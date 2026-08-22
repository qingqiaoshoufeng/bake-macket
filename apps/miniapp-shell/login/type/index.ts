import type { ProfileCompletionState } from '../../profile-completion/type/index.js';

export type { ProfileCompletionState } from '../../profile-completion/type/index.js';
import type { WechatLoginHandoff } from '../../utils/bridge.js';

export type WechatLoginProfileStage =
  ProfileCompletionState['stage'] | 'finalizing' | 'ready';

export type WechatLoginProfileState = Omit<ProfileCompletionState, 'stage'> & {
  readonly stage: WechatLoginProfileStage;
};

export type { WechatLoginHandoff };
