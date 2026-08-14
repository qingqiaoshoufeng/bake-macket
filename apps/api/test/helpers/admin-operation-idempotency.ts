import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';

import type { AppConfig } from '../../src/config/env.schema.js';
import { AdminOperationIdempotency } from '../../src/database/entities/admin-operation-idempotency.entity.js';
import { AdminOperationIdempotencyService } from '../../src/printing/admin-operation-idempotency.service.js';

export const TEST_ADMIN_JWT_SECRET =
  'test-admin-jwt-secret-at-least-32-characters';
export const TEST_ADMIN_OPERATION_IDEMPOTENCY_SECRET =
  'test-admin-operation-idempotency-secret-at-least-32-characters';

export const createAdminOperationIdempotencyTestConfig = (
  idempotencySecret = TEST_ADMIN_OPERATION_IDEMPOTENCY_SECRET,
  adminJwtSecret = TEST_ADMIN_JWT_SECRET,
): ConfigService<AppConfig, true> =>
  ({
    get: (key: string) => {
      if (key !== 'appEnv') return undefined;
      return {
        JWT_ADMIN_SECRET: adminJwtSecret,
        ADMIN_OPERATION_IDEMPOTENCY_SECRET: idempotencySecret,
      };
    },
  }) as ConfigService<AppConfig, true>;

export const createAdminOperationIdempotencyTestService = (
  repository: Repository<AdminOperationIdempotency>,
): AdminOperationIdempotencyService =>
  new AdminOperationIdempotencyService(
    repository,
    createAdminOperationIdempotencyTestConfig(),
  );
