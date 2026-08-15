import { describe, expect, it, vi } from 'vitest';

import { OrderContactAndAdminLoginPhone1718000000013 } from './0015-order-contact-and-admin-login-phone.js';

type SchemaState = {
  columns: Set<string>;
  indexes: Set<string>;
  checks: Set<string>;
};

const schemaKey = (table: string, name: string): string => `${table}.${name}`;

const createRunner = (
  initial?: Partial<SchemaState>,
  newData: { users?: boolean; admins?: boolean } = {},
) => {
  const state: SchemaState = {
    columns: new Set(initial?.columns ?? []),
    indexes: new Set(initial?.indexes ?? []),
    checks: new Set(
      initial?.checks ?? ['admin_users.chk_admin_users_role_identity'],
    ),
  };
  const statements: string[] = [];
  const query = vi.fn(async (sql: string, parameters?: string[]) => {
    statements.push(sql);
    if (sql.includes('information_schema.COLUMNS')) {
      return [
        {
          count: state.columns.has(schemaKey(parameters![0], parameters![1]))
            ? 1
            : 0,
        },
      ];
    }
    if (sql.includes('information_schema.STATISTICS')) {
      return [
        {
          count: state.indexes.has(schemaKey(parameters![0], parameters![1]))
            ? 1
            : 0,
        },
      ];
    }
    if (sql.includes('information_schema.TABLE_CONSTRAINTS')) {
      return [
        {
          count: state.checks.has(schemaKey(parameters![0], parameters![1]))
            ? 1
            : 0,
        },
      ];
    }
    if (sql.includes('ADD COLUMN `order_contact_phone` ')) {
      state.columns.add('users.order_contact_phone');
    }
    if (sql.includes('ADD COLUMN `order_contact_phone_version` ')) {
      state.columns.add('users.order_contact_phone_version');
    }
    if (sql.includes('ADD COLUMN `login_phone` ')) {
      state.columns.add('admin_users.login_phone');
    }
    if (sql.includes('ADD UNIQUE INDEX `uniq_admin_users_login_phone`')) {
      state.indexes.add('admin_users.uniq_admin_users_login_phone');
    }
    if (sql.includes('DROP CHECK `chk_admin_users_role_identity`')) {
      state.checks.delete('admin_users.chk_admin_users_role_identity');
    }
    if (
      sql.includes('SELECT EXISTS') &&
      sql.includes('FROM `users`') &&
      ((sql.includes('`order_contact_phone`') &&
        !state.columns.has('users.order_contact_phone')) ||
        (sql.includes('`order_contact_phone_version`') &&
          !state.columns.has('users.order_contact_phone_version')))
    ) {
      throw new Error('Unknown users contact column');
    }
    if (
      sql.includes('SELECT EXISTS') &&
      sql.includes('FROM `admin_users`') &&
      sql.includes('`login_phone`') &&
      !state.columns.has('admin_users.login_phone')
    ) {
      throw new Error('Unknown admin_users.login_phone column');
    }
    if (sql.includes('SELECT EXISTS')) {
      const hasData = sql.includes('FROM `users`')
        ? newData.users
        : newData.admins;
      return [{ has_data: hasData ? 1 : 0 }];
    }
    if (sql.includes('ADD CONSTRAINT `chk_admin_users_role_identity`')) {
      state.checks.add('admin_users.chk_admin_users_role_identity');
    }
    if (sql.includes('DROP INDEX `uniq_admin_users_login_phone`')) {
      state.indexes.delete('admin_users.uniq_admin_users_login_phone');
    }
    if (sql.includes('DROP COLUMN `login_phone`')) {
      state.columns.delete('admin_users.login_phone');
    }
    if (sql.includes('DROP COLUMN `order_contact_phone_version`')) {
      state.columns.delete('users.order_contact_phone_version');
    }
    if (sql.includes('DROP COLUMN `order_contact_phone`')) {
      state.columns.delete('users.order_contact_phone');
    }
    return undefined;
  });
  return { query, statements, state };
};

describe('OrderContactAndAdminLoginPhone1718000000013', () => {
  it('adds independent contact/login columns and backfills only valid mainland phones', async () => {
    const runner = createRunner();

    await new OrderContactAndAdminLoginPhone1718000000013().up(runner as never);

    const sql = runner.statements.join('\n');
    expect(sql).toContain(
      'ADD COLUMN `order_contact_phone` VARCHAR(32) NULL AFTER `phone_verified`',
    );
    expect(sql).toContain(
      'ADD COLUMN `order_contact_phone_version` INT UNSIGNED NOT NULL DEFAULT 0',
    );
    expect(sql).toContain(
      'ADD COLUMN `login_phone` VARCHAR(32) NULL AFTER `role`',
    );
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringContaining('`phone` REGEXP ?'),
      ['^1[0-9]{10}$'],
    );
    expect(sql).not.toMatch(/order_contact_phone.*UNIQUE/i);
  });

  it('deactivates only active legacy operators and permits inactive rows awaiting reauthorization', async () => {
    const runner = createRunner();

    await new OrderContactAndAdminLoginPhone1718000000013().up(runner as never);

    const sql = runner.statements.join('\n');
    expect(sql).toContain(
      'AND `login_phone` IS NULL\n         AND `is_active` = 1',
    );
    expect(sql).toContain('(`login_phone` IS NOT NULL OR `is_active` = 0)');
  });

  it('down can resume after all 0014 columns and index were already removed', async () => {
    const runner = createRunner();

    await expect(
      new OrderContactAndAdminLoginPhone1718000000013().down(runner as never),
    ).resolves.toBeUndefined();

    expect(runner.statements.join('\n')).not.toContain(
      'SELECT EXISTS(SELECT 1 FROM `users`',
    );
    expect(runner.statements.join('\n')).not.toContain(
      'SELECT EXISTS(SELECT 1 FROM `admin_users`',
    );
  });

  it.each([
    ['orders contact data', { users: true }],
    ['admin login data', { admins: true }],
  ])('down fails closed when %s exists', async (_label, newData) => {
    const runner = createRunner(
      {
        columns: new Set([
          'users.order_contact_phone',
          'users.order_contact_phone_version',
          'admin_users.login_phone',
        ]),
        indexes: new Set(['admin_users.uniq_admin_users_login_phone']),
      },
      newData,
    );

    await expect(
      new OrderContactAndAdminLoginPhone1718000000013().down(runner as never),
    ).rejects.toThrow('down refused: new contact or admin login data exists');
    expect(runner.state.columns).toEqual(
      new Set([
        'users.order_contact_phone',
        'users.order_contact_phone_version',
        'admin_users.login_phone',
      ]),
    );
    expect(runner.state.indexes).toContain(
      'admin_users.uniq_admin_users_login_phone',
    );
    expect(runner.state.checks).toContain(
      'admin_users.chk_admin_users_role_identity',
    );
  });

  it('uses MySQL 8.4 DROP CHECK and can resume after columns/index already exist', async () => {
    const runner = createRunner({
      columns: new Set([
        'users.order_contact_phone',
        'users.order_contact_phone_version',
        'admin_users.login_phone',
      ]),
      indexes: new Set(['admin_users.uniq_admin_users_login_phone']),
    });

    await new OrderContactAndAdminLoginPhone1718000000013().up(runner as never);

    const sql = runner.statements.join('\n');
    expect(sql).toContain('DROP CHECK `chk_admin_users_role_identity`');
    expect(sql).not.toContain(
      'DROP CONSTRAINT `chk_admin_users_role_identity`',
    );
    expect(sql).not.toContain('ADD COLUMN `order_contact_phone`');
    expect(sql).not.toContain('ADD COLUMN `order_contact_phone_version`');
    expect(sql).not.toContain('ADD COLUMN `login_phone`');
    expect(sql).not.toContain(
      'ADD UNIQUE INDEX `uniq_admin_users_login_phone`',
    );
    expect(runner.state.checks).toContain(
      'admin_users.chk_admin_users_role_identity',
    );
  });
});
