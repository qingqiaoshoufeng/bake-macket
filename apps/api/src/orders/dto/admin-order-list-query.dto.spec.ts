import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { AdminOrderListQueryDto } from './admin-order-list-query.dto.js';

const validateQuery = (
  field: 'createdAtFrom' | 'createdAtBefore',
  value: string,
) => validate(plainToInstance(AdminOrderListQueryDto, { [field]: value }));

describe('AdminOrderListQueryDto', () => {
  it.each([
    '2026-07-19T12:30:00Z',
    '2026-07-19T12:30:00.123Z',
    '2026-07-19T20:30:00+08:00',
    '2026-07-19T04:30:00-08:00',
  ])(
    'accepts complete datetimes with an explicit timezone: %s',
    async (value) => {
      await expect(validateQuery('createdAtFrom', value)).resolves.toEqual([]);
    },
  );

  it.each([
    '2026-07-19',
    '2026-07-19T12:30:00',
    '2026-07-19T12:30:00.123',
    '2026-07-19 12:30:00Z',
    '2026-13-40T25:61:61Z',
  ])('rejects incomplete or offsetless datetimes: %s', async (value) => {
    const errors = await validateQuery('createdAtBefore', value);

    expect(errors).toEqual([
      expect.objectContaining({ property: 'createdAtBefore' }),
    ]);
  });
});
