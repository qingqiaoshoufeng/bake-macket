import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import type { CreateMembershipPurchaseRequest } from '@bake-mall/contracts';

import { CreateMembershipPurchaseDto } from './membership-purchase.dto.js';

const acceptsCreateMembershipPurchaseRequest = (
  request: CreateMembershipPurchaseRequest,
): CreateMembershipPurchaseRequest => request;

describe('CreateMembershipPurchaseDto', () => {
  it('implements the shared request contract and keeps runtime validation', async () => {
    const dto = new CreateMembershipPurchaseDto();
    dto.levelId = 'level-1';

    expect(acceptsCreateMembershipPurchaseRequest(dto)).toEqual({
      levelId: 'level-1',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);

    dto.levelId = 'x'.repeat(65);
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
