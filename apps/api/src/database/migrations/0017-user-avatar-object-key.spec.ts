import { describe, expect, it, vi } from 'vitest';

import { UserAvatarObjectKey1718000000015 } from './0017-user-avatar-object-key.js';

const statementsOf = (query: ReturnType<typeof vi.fn>): string[] =>
  query.mock.calls.map(([sql]) => String(sql).replace(/\s+/gu, ' ').trim());

describe('UserAvatarObjectKey1718000000015', () => {
  it('adds a nullable avatar object key without backfilling historical avatar URLs', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new UserAvatarObjectKey1718000000015().up({ query } as never);

    expect(statementsOf(query)).toEqual([
      'ALTER TABLE `users` ADD COLUMN `avatar_object_key` VARCHAR(512) NULL AFTER `avatar_url`',
    ]);
  });

  it('drops only the avatar object key on rollback', async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new UserAvatarObjectKey1718000000015().down({ query } as never);

    expect(statementsOf(query)).toEqual([
      'ALTER TABLE `users` DROP COLUMN `avatar_object_key`',
    ]);
  });
});
