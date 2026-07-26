import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { DefaultMembershipLevels1718000000006 } from './0007-default-membership-levels.js';

const createRunner = (
  existing: Array<{ id: string; code: string; rank: number }> = [],
  references = { purchases: 0, memberships: 0 },
) => {
  const inserted: unknown[][] = [];
  const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
    if (sql.includes('SELECT `id`, `code`, `rank` FROM `membership_levels`')) {
      return existing;
    }
    if (sql.includes('INSERT INTO `membership_levels`')) {
      inserted.push(parameters ?? []);
      return { affectedRows: 1 };
    }
    if (sql.includes('membership_purchase_orders')) {
      return [{ count: String(references.purchases) }];
    }
    if (sql.includes('user_memberships')) {
      return [{ count: String(references.memberships) }];
    }
    return [];
  });
  return {
    inserted,
    runner: {
      query,
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      isTransactionActive: false,
    } as unknown as QueryRunner,
    query,
  };
};

describe('DefaultMembershipLevels1718000000006', () => {
  it('inserts four active levels with exact pricing and themes', async () => {
    const { runner, inserted } = createRunner();

    await new DefaultMembershipLevels1718000000006().up(runner);

    expect(inserted).toHaveLength(4);
    expect(inserted).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['SILVER', 10, 9900, 1000, 9500, 'PEARL']),
        expect.arrayContaining(['GOLD', 20, 19900, 3000, 9000, 'CHAMPAGNE']),
        expect.arrayContaining(['DIAMOND', 30, 39900, 8000, 8500, 'JADE']),
        expect.arrayContaining(['BLACK', 40, 69900, 16000, 8000, 'OBSIDIAN']),
      ]),
    );
    expect(
      inserted.every((parameters) =>
        [365, 1, 1].every((value) => parameters.includes(value)),
      ),
    ).toBe(true);
    const benefits = inserted.map((parameters) => {
      const serialized = parameters.find(
        (value) => typeof value === 'string' && value.startsWith('[{'),
      );
      return JSON.parse(String(serialized)) as Array<{
        title: string;
        sortOrder: number;
      }>;
    });
    expect(benefits.map((items) => items[0]?.sortOrder)).toEqual([
      10, 10, 10, 10,
    ]);
    expect(benefits.map((items) => items[0]?.title)).toEqual([
      '全场商品 9.5 折',
      '全场商品 9 折',
      '全场商品 8.5 折',
      '全场商品 8 折',
    ]);
  });

  it('joins an existing transaction without committing or rolling it back', async () => {
    const { runner } = createRunner();
    Object.assign(runner, { isTransactionActive: true });

    await new DefaultMembershipLevels1718000000006().up(runner);

    expect(runner.startTransaction).not.toHaveBeenCalled();
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
  });

  it('keeps an existing matching code and rank without overwriting it', async () => {
    const { runner, inserted } = createRunner([
      { id: '1', code: 'GOLD', rank: 20 },
    ]);

    await new DefaultMembershipLevels1718000000006().up(runner);

    expect(inserted).toHaveLength(3);
    expect(inserted.flat()).not.toContain('GOLD');
  });

  it('rolls back when code and rank do not identify the same level', async () => {
    const { runner } = createRunner([
      { id: '1', code: 'GOLD', rank: 10 },
      { id: '2', code: 'SILVER', rank: 20 },
    ]);

    await expect(
      new DefaultMembershipLevels1718000000006().up(runner),
    ).rejects.toThrow(/conflict/i);
    expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
  });

  it.each([
    [{ purchases: 1, memberships: 0 }, /membership_purchase_orders/],
    [{ purchases: 0, memberships: 1 }, /user_memberships/],
  ])(
    'refuses to remove default levels referenced by business records',
    async (references, expectedError) => {
      const { runner } = createRunner([], references);

      await expect(
        new DefaultMembershipLevels1718000000006().down(runner),
      ).rejects.toThrow(expectedError);
      expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
    },
  );

  it('deletes default levels when no business records reference them', async () => {
    const { runner, query } = createRunner();

    await new DefaultMembershipLevels1718000000006().down(runner);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM `membership_levels`'),
      ['SILVER', 'GOLD', 'DIAMOND', 'BLACK'],
    );
    expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });
});
