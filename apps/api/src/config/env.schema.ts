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
