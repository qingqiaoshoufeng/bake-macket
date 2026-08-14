import { describe, expect, it } from 'vitest';

import {
  buildDataSourceOptions,
  envSchema,
  validateEnvironment,
} from './env.schema.js';

const DATABASE_ENV = {
  DATABASE_URL: 'mysql://user:password@127.0.0.1:3306/bake_mall',
};
const DEVELOPMENT_QUOTE_SECRET =
  'dev-only-order-quote-secret-must-be-at-least-32';
const PRODUCTION_ENVIRONMENT = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://user:password@database.example.com:3306/bake_mall',
  JWT_USER_SECRET: 'production-user-jwt-secret-not-a-placeholder',
  JWT_ADMIN_SECRET: 'production-admin-jwt-secret-not-a-placeholder',
  ADMIN_OPERATION_IDEMPOTENCY_SECRET:
    'production-admin-operation-idempotency-secret-not-placeholder',
  ORDER_QUOTE_TOKEN_SECRET: 'production-order-quote-secret-not-placeholder',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'production-admin-password',
  OBJECT_STORAGE_ENDPOINT: 'https://storage.example.com',
  OBJECT_STORAGE_REGION: 'ap-shanghai',
  OBJECT_STORAGE_BUCKET: 'bake-mall-production',
  OBJECT_STORAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/bake-mall',
  OBJECT_STORAGE_ACCESS_KEY: 'production-access-key',
  OBJECT_STORAGE_SECRET_KEY: 'production-secret-key',
  OBJECT_STORAGE_FORCE_PATH_STYLE: false,
  WECHAT_APP_ID: 'wx-production-app-id',
  WECHAT_APP_SECRET: 'production-wechat-secret',
  XPYUN_USER: 'production-xpyun-developer',
  XPYUN_USER_KEY: 'production-xpyun-user-key',
  XPYUN_BASE_URL: 'https://open.xpyun.net',
  XPYUN_TIMEOUT_MS: 5_000,
} as const;

describe('buildDataSourceOptions', () => {
  it('runs each MySQL migration in its own transaction', () => {
    const { error, value } = envSchema.validate({
      ...DATABASE_ENV,
      NODE_ENV: 'test',
    });

    expect(error).toBeUndefined();
    expect(buildDataSourceOptions(value)).toMatchObject({
      migrationsTransactionMode: 'each',
    });
  });
});

describe('微信运行时配置', () => {
  it.each(['WECHAT_APP_ID', 'WECHAT_APP_SECRET'] as const)(
    'production 缺少 %s 时拒绝启动',
    (field) => {
      expect(() =>
        validateEnvironment({
          ...PRODUCTION_ENVIRONMENT,
          WECHAT_APP_ID: 'wx-production-app-id',
          WECHAT_APP_SECRET: 'production-wechat-secret',
          [field]: undefined,
        }),
      ).toThrow(field);
    },
  );

  it.each([
    ['WECHAT_APP_ID', 'REPLACE_WITH_WECHAT_APP_ID'],
    ['WECHAT_APP_SECRET', 'REPLACE_WITH_WECHAT_APP_SECRET'],
  ] as const)('production 拒绝 %s placeholder', (field, placeholder) => {
    expect(() =>
      validateEnvironment({
        ...PRODUCTION_ENVIRONMENT,
        WECHAT_APP_ID: 'wx-production-app-id',
        WECHAT_APP_SECRET: 'production-wechat-secret',
        [field]: placeholder,
      }),
    ).toThrow('Invalid production environment configuration');
  });

  it.each(['WECHAT_APP_ID', 'WECHAT_APP_SECRET'] as const)(
    'production 拒绝仅包含空白的 %s',
    (field) => {
      expect(() =>
        validateEnvironment({
          ...PRODUCTION_ENVIRONMENT,
          WECHAT_APP_ID: ' wx-production-app-id ',
          WECHAT_APP_SECRET: ' production-wechat-secret ',
          [field]: '   ',
        }),
      ).toThrow(field);
    },
  );

  it('trim production WeChat credentials before exposing configuration', () => {
    expect(
      validateEnvironment({
        ...PRODUCTION_ENVIRONMENT,
        WECHAT_APP_ID: ' wx-production-app-id ',
        WECHAT_APP_SECRET: ' production-wechat-secret ',
      }),
    ).toMatchObject({
      WECHAT_APP_ID: 'wx-production-app-id',
      WECHAT_APP_SECRET: 'production-wechat-secret',
    });
  });

  it.each(['development', 'test'] as const)(
    '%s 允许空微信配置以保留本地 fake 登录',
    (nodeEnv) => {
      const { error, value } = envSchema.validate({
        ...DATABASE_ENV,
        NODE_ENV: nodeEnv,
        WECHAT_APP_ID: '',
        WECHAT_APP_SECRET: '',
      });

      expect(error).toBeUndefined();
      expect(value).toMatchObject({ WECHAT_APP_ID: '', WECHAT_APP_SECRET: '' });
    },
  );
});

describe('芯烨云运行时配置', () => {
  it.each(['XPYUN_USER', 'XPYUN_USER_KEY'] as const)(
    'production 缺少 %s 时拒绝启动',
    (field) => {
      expect(() =>
        validateEnvironment({ ...PRODUCTION_ENVIRONMENT, [field]: undefined }),
      ).toThrow(field);
    },
  );

  it.each([
    ['XPYUN_USER', 'REPLACE_WITH_XPYUN_USER'],
    ['XPYUN_USER_KEY', 'REPLACE_WITH_XPYUN_USER_KEY'],
  ] as const)('production 拒绝 %s placeholder', (field, placeholder) => {
    expect(() =>
      validateEnvironment({ ...PRODUCTION_ENVIRONMENT, [field]: placeholder }),
    ).toThrow('Invalid production environment configuration');
  });

  it.each([
    ['XPYUN_USER', 'local-xpyun-user'],
    ['XPYUN_USER_KEY', 'local-xpyun-user-key'],
  ] as const)('production 拒绝公开的 %s fallback', (field, value) => {
    expect(() =>
      validateEnvironment({ ...PRODUCTION_ENVIRONMENT, [field]: value }),
    ).toThrow('Invalid production environment configuration');
  });

  it('production 使用官方 HTTPS base URL 并拒绝 HTTP 覆盖', () => {
    expect(validateEnvironment(PRODUCTION_ENVIRONMENT)).toMatchObject({
      XPYUN_BASE_URL: 'https://open.xpyun.net',
      XPYUN_TIMEOUT_MS: 5_000,
    });
    expect(() =>
      validateEnvironment({
        ...PRODUCTION_ENVIRONMENT,
        XPYUN_BASE_URL: 'http://127.0.0.1:43999',
      }),
    ).toThrow('XPYUN_BASE_URL');
  });

  it('production 对 base URL 和 timeout 使用安全默认值，只显式要求凭据', () => {
    const { XPYUN_BASE_URL, XPYUN_TIMEOUT_MS } = validateEnvironment({
      ...PRODUCTION_ENVIRONMENT,
      XPYUN_BASE_URL: undefined,
      XPYUN_TIMEOUT_MS: undefined,
    });

    expect(XPYUN_BASE_URL).toBe('https://open.xpyun.net');
    expect(XPYUN_TIMEOUT_MS).toBe(10_000);
  });

  it.each(['development', 'test'] as const)(
    '%s 允许 fake 凭据和本地 HTTP fake server',
    (nodeEnv) => {
      expect(
        validateEnvironment({
          ...DATABASE_ENV,
          NODE_ENV: nodeEnv,
          XPYUN_USER: 'local-xpyun-user',
          XPYUN_USER_KEY: 'local-xpyun-user-key',
          XPYUN_BASE_URL: 'http://127.0.0.1:43999',
          XPYUN_TIMEOUT_MS: 25,
        }),
      ).toMatchObject({
        XPYUN_USER: 'local-xpyun-user',
        XPYUN_USER_KEY: 'local-xpyun-user-key',
        XPYUN_BASE_URL: 'http://127.0.0.1:43999',
        XPYUN_TIMEOUT_MS: 25,
      });
    },
  );

  it.each([
    'http://example.com',
    'ftp://127.0.0.1:43999',
    'https://developer:secret@example.com',
    'https://example.com/api?secret=value',
    'https://example.com/api#fragment',
  ])('拒绝不安全或带附加数据的 base URL：%s', (baseUrl) => {
    expect(() =>
      validateEnvironment({
        ...DATABASE_ENV,
        NODE_ENV: 'test',
        XPYUN_BASE_URL: baseUrl,
      }),
    ).toThrow('XPYUN_BASE_URL');
  });

  it.each([0, -1, 1.5, 60_001])(
    '拒绝不合理的 XPYUN_TIMEOUT_MS：%s',
    (timeoutMs) => {
      expect(() =>
        validateEnvironment({
          ...DATABASE_ENV,
          NODE_ENV: 'test',
          XPYUN_TIMEOUT_MS: timeoutMs,
        }),
      ).toThrow('XPYUN_TIMEOUT_MS');
    },
  );

  it('AppEnv 暴露四项芯烨云配置的已验证类型', () => {
    const env = validateEnvironment({
      ...DATABASE_ENV,
      NODE_ENV: 'test',
    });
    const xpyunConfig: Readonly<{
      XPYUN_USER: string;
      XPYUN_USER_KEY: string;
      XPYUN_BASE_URL: string;
      XPYUN_TIMEOUT_MS: number;
    }> = env;

    expect(xpyunConfig).toMatchObject({
      XPYUN_USER: '',
      XPYUN_USER_KEY: '',
      XPYUN_BASE_URL: 'https://open.xpyun.net',
      XPYUN_TIMEOUT_MS: 10_000,
    });
  });
});

describe('admin operation idempotency secret', () => {
  it.each([
    ['missing', undefined],
    [
      'placeholder',
      'REPLACE_WITH_UNIQUE_ADMIN_OPERATION_IDEMPOTENCY_SECRET_AT_LEAST_32_CHARACTERS',
    ],
  ])('rejects a %s production secret', (_caseName, secret) => {
    expect(() =>
      validateEnvironment({
        ...PRODUCTION_ENVIRONMENT,
        ADMIN_OPERATION_IDEMPOTENCY_SECRET: secret,
      }),
    ).toThrow(/ADMIN_OPERATION_IDEMPOTENCY_SECRET|production environment/iu);
  });

  it.each([
    ['admin', PRODUCTION_ENVIRONMENT.JWT_ADMIN_SECRET],
    ['user', PRODUCTION_ENVIRONMENT.JWT_USER_SECRET],
  ])(
    'rejects coupling the idempotency secret to the %s JWT secret',
    (_audience, jwtSecret) => {
      expect(() =>
        validateEnvironment({
          ...PRODUCTION_ENVIRONMENT,
          ADMIN_OPERATION_IDEMPOTENCY_SECRET: jwtSecret,
        }),
      ).toThrow('Invalid production environment configuration');
    },
  );

  it.each(['development', 'test'] as const)(
    'provides an independent fallback in %s',
    (nodeEnv) => {
      const env = validateEnvironment({
        ...DATABASE_ENV,
        NODE_ENV: nodeEnv,
      });

      expect(env.ADMIN_OPERATION_IDEMPOTENCY_SECRET).toEqual(
        expect.any(String),
      );
      expect(env.ADMIN_OPERATION_IDEMPOTENCY_SECRET).not.toBe(
        env.JWT_ADMIN_SECRET,
      );
    },
  );
});

describe('envSchema order quote secret', () => {
  it.each([
    ['a missing secret', undefined],
    ['the public development secret', DEVELOPMENT_QUOTE_SECRET],
  ])('rejects %s in production', (_caseName, orderQuoteTokenSecret) => {
    const { error } = envSchema.validate({
      ...DATABASE_ENV,
      NODE_ENV: 'production',
      ORDER_QUOTE_TOKEN_SECRET: orderQuoteTokenSecret,
    });

    expect(error).toBeDefined();
    expect(error?.message).toContain('ORDER_QUOTE_TOKEN_SECRET');
  });

  it.each(['development', 'test'] as const)(
    'defaults the quote secret in %s',
    (nodeEnv) => {
      const { error, value } = envSchema.validate({
        ...DATABASE_ENV,
        NODE_ENV: nodeEnv,
      });

      expect(error).toBeUndefined();
      expect(value.ORDER_QUOTE_TOKEN_SECRET).toBe(DEVELOPMENT_QUOTE_SECRET);
    },
  );
});
