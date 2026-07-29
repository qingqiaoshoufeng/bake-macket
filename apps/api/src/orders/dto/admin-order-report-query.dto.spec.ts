import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { AdminOrderExportQueryDto } from './admin-order-export-query.dto.js';
import { AdminOrderSupplyDetailQueryDto } from './admin-order-supply-detail-query.dto.js';
import { AdminOrderSupplyQueryDto } from './admin-order-supply-query.dto.js';

const validateSupply = (value: Record<string, unknown>) =>
  validate(plainToInstance(AdminOrderSupplyQueryDto, value));
const validateDetail = (value: Record<string, unknown>) =>
  validate(plainToInstance(AdminOrderSupplyDetailQueryDto, value));
const validateExport = (value: Record<string, unknown>) =>
  validate(plainToInstance(AdminOrderExportQueryDto, value));

const hasError = (
  errors: Awaited<ReturnType<typeof validate>>,
  property: string,
): boolean => errors.some((error) => error.property === property);

describe('admin order report query DTOs', () => {
  it('converts repeated and single supply status query values to arrays', async () => {
    await expect(
      validateSupply({ supplyStatuses: ['NEW', 'PROCESSING'] }),
    ).resolves.toEqual([]);
    const single = plainToInstance(AdminOrderSupplyQueryDto, {
      supplyStatuses: 'NEW',
    });
    await expect(validate(single)).resolves.toEqual([]);
    expect(single.supplyStatuses).toEqual(['NEW']);
  });

  it.each([
    ['missing', undefined],
    ['empty', []],
    ['unsupported', ['COMPLETED']],
    ['duplicate', ['NEW', 'NEW']],
    ['too many', ['NEW', 'PROCESSING', 'NEW']],
  ])('rejects %s supply statuses', async (_name, supplyStatuses) => {
    const errors = await validateSupply(
      supplyStatuses === undefined ? {} : { supplyStatuses },
    );

    expect(hasError(errors, 'supplyStatuses')).toBe(true);
  });

  it('requires an opaque group key for supply details', async () => {
    await expect(
      validateDetail({ groupKey: 'sku:1', supplyStatuses: ['NEW'] }),
    ).resolves.toEqual([]);
    const errors = await validateDetail({ supplyStatuses: ['NEW'] });
    expect(hasError(errors, 'groupKey')).toBe(true);
  });

  it('accepts mutually exclusive ORDER and SUPPLY export query shapes', async () => {
    await expect(
      validateExport({ view: 'ORDER', status: 'COMPLETED' }),
    ).resolves.toEqual([]);
    await expect(
      validateExport({ view: 'SUPPLY', supplyStatuses: ['NEW'] }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['SUPPLY without statuses', { view: 'SUPPLY' }],
    [
      'SUPPLY with order status',
      { view: 'SUPPLY', supplyStatuses: ['NEW'], status: 'NEW' },
    ],
    ['ORDER with supply statuses', { view: 'ORDER', supplyStatuses: ['NEW'] }],
    ['invalid view', { view: 'OTHER' }],
  ])('rejects %s', async (_name, query) => {
    await expect(validateExport(query)).resolves.not.toEqual([]);
  });

  it('validates shared amount, time and pagination fields', async () => {
    const errors = await validateSupply({
      supplyStatuses: ['NEW'],
      minPayableCents: -1,
      createdAtFrom: '2026-07-28',
      page: 0,
      pageSize: 101,
    });

    expect(hasError(errors, 'minPayableCents')).toBe(true);
    expect(hasError(errors, 'createdAtFrom')).toBe(true);
    expect(hasError(errors, 'page')).toBe(true);
    expect(hasError(errors, 'pageSize')).toBe(true);
  });
});
