import { ConflictException, NotFoundException } from '@nestjs/common';
import { ApiErrorCode } from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { User } from '../database/entities/user.entity.js';
import { OrderContactPhoneService } from './order-contact-phone.service.js';

const userFixture = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    phone: '13800000000',
    phoneVerified: true,
    orderContactPhone: '13900000000',
    orderContactPhoneVersion: 3,
    tokenVersion: 7,
    isActive: true,
    mergedIntoUserId: null,
    ...overrides,
  }) as User;

const build = (user: User | null) => {
  const findOne = vi.fn().mockResolvedValue(user);
  const update = vi.fn().mockResolvedValue({ affected: 1 });
  const repository = { findOne, update };
  const transaction = vi.fn(async (operation) =>
    operation({
      getRepository: (entity: unknown) => (entity === User ? repository : null),
    }),
  );
  const service = new OrderContactPhoneService({ transaction } as never);
  return { service, findOne, transaction, update };
};

describe('OrderContactPhoneService', () => {
  it('locks the User row and returns an idempotent same-value response without saving', async () => {
    const original = userFixture();
    const harness = build(original);

    await expect(
      harness.service.update('user-1', '13900000000', 3),
    ).resolves.toEqual({
      configured: true,
      maskedPhone: '139****0000',
      version: 3,
    });

    expect(harness.findOne).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(harness.update).not.toHaveBeenCalled();
    expect(original).toMatchObject({
      phone: '13800000000',
      phoneVerified: true,
      tokenVersion: 7,
      orderContactPhoneVersion: 3,
    });
  });

  it('normalizes surrounding whitespace before comparing an idempotent same-value update', async () => {
    const harness = build(userFixture());

    await expect(
      harness.service.update('user-1', ' 13900000000 ', 3),
    ).resolves.toEqual({
      configured: true,
      maskedPhone: '139****0000',
      version: 3,
    });

    expect(harness.update).not.toHaveBeenCalled();
  });

  it('increments only the order contact version and leaves identity/token fields unchanged', async () => {
    const original = userFixture();
    const harness = build(original);

    await expect(
      harness.service.update('user-1', '13700000000', 3),
    ).resolves.toEqual({
      configured: true,
      maskedPhone: '137****0000',
      version: 4,
    });

    expect(harness.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      {
        orderContactPhone: '13700000000',
        orderContactPhoneVersion: 4,
      },
    );
    expect(harness.update.mock.calls[0]?.[1]).not.toHaveProperty('phone');
    expect(harness.update.mock.calls[0]?.[1]).not.toHaveProperty(
      'phoneVerified',
    );
    expect(harness.update.mock.calls[0]?.[1]).not.toHaveProperty(
      'tokenVersion',
    );
    expect(original).toMatchObject({
      orderContactPhone: '13900000000',
      orderContactPhoneVersion: 3,
    });
  });

  it('rejects a stale expected version with the stable shared error code', async () => {
    const harness = build(userFixture());

    await expect(
      harness.service.update('user-1', '13700000000', 2),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: ApiErrorCode.ORDER_CONTACT_PHONE_UPDATE_VERSION_CONFLICT,
      }),
    });
    expect(harness.update).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', userFixture({ isActive: false })],
    ['merged', userFixture({ mergedIntoUserId: 'canonical-user' })],
  ])('rejects %s users before saving', async (_label, user) => {
    const harness = build(user);

    await expect(
      harness.service.update('user-1', '13700000000', 3),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it('rejects a missing user', async () => {
    await expect(
      build(null).service.update('missing', '13700000000', 0),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
