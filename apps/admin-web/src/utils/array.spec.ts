import { describe, expect, it } from 'vitest';

import { partition } from './array.js';

describe('partition', () => {
  it('returns two new arrays without mutating the source', () => {
    const source = Object.freeze([1, 2, 3, 4]);

    const result = partition(source, (value) => value % 2 === 0);

    expect(result).toEqual({ satisfied: [2, 4], rest: [1, 3] });
    expect(result.satisfied).not.toBe(source);
    expect(result.rest).not.toBe(source);
    expect(source).toEqual([1, 2, 3, 4]);
  });
});
