import { DEVELOPMENT_LOGIN_HINT } from '../../../bridge/miniapp.js';

interface DevelopmentLoginDefaults {
  readonly phone: string;
  readonly code: string;
}

const EMPTY_DEVELOPMENT_LOGIN: DevelopmentLoginDefaults = {
  phone: '',
  code: '',
};

export function getDefaultDevelopmentLogin(
  isDevelopment: boolean,
): DevelopmentLoginDefaults {
  return isDevelopment ? DEVELOPMENT_LOGIN_HINT : EMPTY_DEVELOPMENT_LOGIN;
}
