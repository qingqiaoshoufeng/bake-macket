import { describe, expect, it } from 'vitest';

import { escapeLike, toPaginatedView } from './admin-query.helpers.js';

describe('admin query helpers', () => {
  it('escapes MySQL LIKE wildcard characters', () => {
    expect(escapeLike(String.raw`50%_off\today`)).toBe(
      String.raw`50\%\_off\\today`,
    );
  });

  it('builds a stable paginated response', () => {
    expect(toPaginatedView(['item'], 7, 2, 20)).toEqual({
      items: ['item'],
      total: 7,
      page: 2,
      pageSize: 20,
    });
  });
});
