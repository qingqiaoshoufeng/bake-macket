import { ApiErrorCode } from '@bake-mall/contracts';
import { BadRequestException } from '@nestjs/common';

import { isCanonicalAdminOperationIdempotencyKey } from './admin-operation-idempotency.service.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export const requirePrintingIdempotencyKey = (
  header: string | undefined,
): string => {
  if (!isCanonicalAdminOperationIdempotencyKey(header)) {
    throw new BadRequestException({
      code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
      message: 'Idempotency-Key must be a canonical lowercase UUID v4',
    });
  }
  return header;
};
