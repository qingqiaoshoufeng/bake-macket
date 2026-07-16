interface DefaultAdminLoginInput {
  readonly isDevelopment: boolean;
  readonly email?: string;
  readonly password?: string;
}

interface AdminLoginDefaults {
  readonly email: string;
  readonly password: string;
}

const EMPTY_ADMIN_LOGIN: AdminLoginDefaults = {
  email: '',
  password: '',
};

export function getDefaultAdminLogin({
  isDevelopment,
  email,
  password,
}: DefaultAdminLoginInput): AdminLoginDefaults {
  if (!isDevelopment) return EMPTY_ADMIN_LOGIN;

  return {
    email: email ?? '',
    password: password ?? '',
  };
}
