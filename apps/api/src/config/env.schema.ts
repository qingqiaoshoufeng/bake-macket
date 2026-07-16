import Joi from 'joi';

/**
 * Environment configuration values validated by {@link envSchema}.
 *
 * Centralising the shape keeps `ConfigModule` consumers and the runtime bootstrap
 * aligned. The database fields accept either a single {@link DATABASE_URL} or
 * discrete {@link MYSQL_HOST}/`MYSQL_PORT`/etc. variables so the same code works
 * for Docker Compose locally and managed MySQL in production.
 */
export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;

  DATABASE_URL?: string;
  MYSQL_HOST?: string;
  MYSQL_PORT?: number;
  MYSQL_DATABASE?: string;
  MYSQL_USER?: string;
  MYSQL_PASSWORD?: string;

  /**
   * Secret used to sign customer JWTs (audience `mall-user`). Required because
   * the user session key is never reused for admin sessions.
   */
  JWT_USER_SECRET: string;
  /** Secret used to sign merchant back-office JWTs (audience `mall-admin`). */
  JWT_ADMIN_SECRET: string;
  /**
   * Lifetime for issued JWTs in seconds. Defaults to 24h. Both user and admin
   * sessions share the same lifetime for simplicity.
   */
  JWT_EXPIRES_IN_SECONDS: number;

  /**
   * Optional initial administrator provisioned from environment variables on
   * module bootstrap. Never committed to the repository; deploy-time only.
   */
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;

  /** S3-compatible MinIO (development) or COS (production) credentials. */
  OBJECT_STORAGE_ENDPOINT: string;
  OBJECT_STORAGE_REGION: string;
  OBJECT_STORAGE_BUCKET: string;
  OBJECT_STORAGE_PUBLIC_BASE_URL: string;
  OBJECT_STORAGE_ACCESS_KEY: string;
  OBJECT_STORAGE_SECRET_KEY: string;
  OBJECT_STORAGE_FORCE_PATH_STYLE: boolean;
}

/**
 * Shape of the {@link import('@nestjs/config').ConfigService} exposed to the
 * application. `@nestjs/config` stores the object returned by `validate` under
 * the `appEnv` namespace, so this wrapper is what makes
 * `config.get('appEnv', { infer: true })` type-safe at every call site.
 */
export interface AppConfig {
  appEnv: AppEnv;
}

/**
 * Default JWT secrets for local development and tests only. Production must
 * always provide real, distinct secrets via environment variables — these
 * constants exist to make the development key path predictable for the unit
 * suite while remaining explicitly documented as insecure.
 */
export const FALLBACK_USER_SECRET =
  'dev-only-user-jwt-secret-do-not-use-in-prod';
export const FALLBACK_ADMIN_SECRET =
  'dev-only-admin-jwt-secret-do-not-use-in-prod';

export const envSchema = Joi.object<AppEnv, true>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['mysql', 'mysql2'] })
    .optional(),

  MYSQL_HOST: Joi.string().hostname().optional(),
  MYSQL_PORT: Joi.number().port().default(3306),
  MYSQL_DATABASE: Joi.string().optional(),
  MYSQL_USER: Joi.string().optional(),
  MYSQL_PASSWORD: Joi.string().allow('').optional(),

  JWT_USER_SECRET: Joi.string().min(16).default(FALLBACK_USER_SECRET),
  JWT_ADMIN_SECRET: Joi.string().min(16).default(FALLBACK_ADMIN_SECRET),
  JWT_EXPIRES_IN_SECONDS: Joi.number()
    .integer()
    .positive()
    .default(60 * 60 * 24),

  ADMIN_EMAIL: Joi.string().email().optional(),
  ADMIN_PASSWORD: Joi.string().min(8).optional(),

  OBJECT_STORAGE_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://127.0.0.1:9000'),
  OBJECT_STORAGE_REGION: Joi.string().default('us-east-1'),
  OBJECT_STORAGE_BUCKET: Joi.string().default('bake-mall'),
  OBJECT_STORAGE_PUBLIC_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://127.0.0.1:9000/bake-mall'),
  OBJECT_STORAGE_ACCESS_KEY: Joi.string().default('minioadmin'),
  OBJECT_STORAGE_SECRET_KEY: Joi.string().default('minioadmin'),
  OBJECT_STORAGE_FORCE_PATH_STYLE: Joi.boolean()
    .truthy('true')
    .falsy('false')
    .default(true),
})
  .or('DATABASE_URL', 'MYSQL_HOST')
  .messages({
    'object.missing':
      'Either DATABASE_URL or MYSQL_HOST must be provided to configure the database connection.',
  });

/**
 * Resolve a TypeORM {@link import('typeorm').DataSourceOptions} object from the
 * validated environment. Money columns are integer cents and timestamps are
 * stored in UTC, so `synchronize` stays disabled and migrations are the single
 * source of truth for schema changes.
 */
export function buildDataSourceOptions(env: AppEnv) {
  const url = env.DATABASE_URL;
  const common = {
    type: 'mysql' as const,
    charset: 'utf8mb4' as const,
    timezone: 'Z' as const,
    synchronize: false,
    migrationsRun: false,
  };

  if (url) {
    return {
      ...common,
      url,
    };
  }

  if (!env.MYSQL_HOST || !env.MYSQL_DATABASE || !env.MYSQL_USER) {
    throw new Error(
      'Incomplete MySQL configuration: MYSQL_HOST, MYSQL_DATABASE and MYSQL_USER are required when DATABASE_URL is not set.',
    );
  }

  return {
    ...common,
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT ?? 3306,
    database: env.MYSQL_DATABASE,
    username: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD ?? '',
  };
}
