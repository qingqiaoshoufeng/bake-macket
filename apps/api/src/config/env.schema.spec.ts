import { describe, expect, it } from 'vitest';

import { buildDataSourceOptions, envSchema } from './env.schema.js';

const DATABASE_ENV = {
  DATABASE_URL: 'mysql://user:password@127.0.0.1:3306/bake_mall',
};
const DEVELOPMENT_QUOTE_SECRET =
  'dev-only-order-quote-secret-must-be-at-least-32';

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
