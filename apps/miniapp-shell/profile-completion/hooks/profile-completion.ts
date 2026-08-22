import type { CustomerAuthSessionView } from '@bake-mall/contracts';

import type {
  ProfileCompletionHandoff,
  ProfileCompletionState,
} from '../type/index.js';
import {
  createProfileEditorController,
  profileErrorMessage,
  type ProfileEditorControllerDependencies,
} from './profile-editor.js';

type ProfileCompletionControllerDependencies =
  ProfileEditorControllerDependencies &
    Readonly<{
      authenticate: () => Promise<CustomerAuthSessionView>;
      navigateBack: () => void;
      returnUrl: string;
      writeOutcome: (handoff: ProfileCompletionHandoff) => boolean;
    }>;

export function createProfileCompletionController(
  dependencies: ProfileCompletionControllerDependencies,
) {
  let terminalOutcomeWritten = false;
  const editor = createProfileEditorController(dependencies);

  async function initialize(): Promise<boolean> {
    dependencies.onStateChange({
      ...editor.snapshot(),
      error: null,
      stage: 'authenticating',
    });
    try {
      editor.initializeWithSession(await dependencies.authenticate());
      return true;
    } catch (error) {
      dependencies.onStateChange({
        ...editor.snapshot(),
        error: profileErrorMessage(error, '登录失败，请稍后重试'),
        stage: 'editing',
      });
      return false;
    }
  }

  function writeTerminalOutcome(
    outcome: ProfileCompletionHandoff['outcome'],
    navigate: boolean,
  ): boolean {
    if (terminalOutcomeWritten) return false;
    const written = dependencies.writeOutcome({
      outcome,
      returnUrl: dependencies.returnUrl,
    });
    if (!written) return false;
    terminalOutcomeWritten = true;
    if (navigate) dependencies.navigateBack();
    return true;
  }

  async function save(): Promise<boolean> {
    const profile = await editor.save();
    return profile ? writeTerminalOutcome('PROFILE_UPDATED', true) : false;
  }

  function skip(): boolean {
    return writeTerminalOutcome('PROFILE_SKIPPED', true);
  }

  function handleSystemReturn(): boolean {
    return writeTerminalOutcome('PROFILE_SKIPPED', false);
  }

  function snapshot(): ProfileCompletionState {
    return editor.snapshot();
  }

  return {
    chooseAvatar: editor.chooseAvatar,
    handleSystemReturn,
    initialize,
    save,
    setNickname: editor.setNickname,
    skip,
    snapshot,
  } as const;
}
