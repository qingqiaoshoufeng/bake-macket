import { DEVELOPMENT_LOGIN_HINT } from '../../../bridge/miniapp.js';
import type { LoginFormValues } from '../type/index.js';

export const loginFormMock: Readonly<LoginFormValues> = {
  phone: DEVELOPMENT_LOGIN_HINT.phone,
  code: DEVELOPMENT_LOGIN_HINT.code,
};
