import type {
  CreateUserForm,
  OperatorGrantForm,
  OperatorRevokeForm,
} from '../type/index.js';

export const USER_PAGINATION: Readonly<{
  defaultPage: number;
  defaultPageSize: number;
  pageSizes: readonly number[];
}> = Object.freeze({
  defaultPage: 1,
  defaultPageSize: 20,
  pageSizes: [20, 50, 100] as const,
});

export function createUserDefaults(): CreateUserForm {
  return { phone: '' };
}

export function createOperatorGrantDefaults(): OperatorGrantForm {
  return {
    loginPhone: '',
    currentPassword: '',
    temporaryPassword: '',
    confirmTemporaryPassword: '',
  };
}

export function createOperatorRevokeDefaults(): OperatorRevokeForm {
  return { currentPassword: '', acknowledged: false };
}
