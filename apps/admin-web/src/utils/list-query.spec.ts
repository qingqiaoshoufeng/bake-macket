import { describe, expect, it } from 'vitest';

import {
  compactQuery,
  countActiveFilters,
  toExclusiveDateRange,
} from './list-query.js';

describe('list query helpers', () => {
  it('removes empty values but preserves zero and false', () => {
    expect(
      compactQuery({
        q: '  ',
        status: undefined,
        range: null,
        page: 1,
        count: 0,
        enabled: false,
      }),
    ).toEqual({ page: 1, count: 0, enabled: false });
  });

  it('maps a date range to inclusive from and exclusive before', () => {
    expect(
      toExclusiveDateRange([
        '2026-07-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
      ]),
    ).toEqual({
      from: '2026-07-01T00:00:00.000Z',
      before: '2026-08-01T00:00:00.000Z',
    });
    expect(toExclusiveDateRange(null)).toEqual({});
  });

  it('counts active filters without counting empty collections', () => {
    expect(
      countActiveFilters({
        q: 'cake',
        status: undefined,
        range: [],
        min: 0,
        selected: false,
      }),
    ).toBe(3);
  });
});
