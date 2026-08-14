import { describe, expect, it, vi } from 'vitest';

import { runMigrations } from './run-migrations.js';

describe('runMigrations', () => {
  it('initializes, migrates, and destroys the data source', async () => {
    const dataSource = {
      initialize: vi.fn().mockResolvedValue(undefined),
      runMigrations: vi.fn().mockResolvedValue([]),
      destroy: vi.fn().mockResolvedValue(undefined),
      get isInitialized() {
        return this.initialize.mock.calls.length > 0;
      },
    };

    await runMigrations(dataSource);

    expect(dataSource.initialize).toHaveBeenCalledOnce();
    expect(dataSource.runMigrations).toHaveBeenCalledOnce();
    expect(dataSource.destroy).toHaveBeenCalledOnce();
  });

  it('destroys an initialized data source when migration fails', async () => {
    const migrationError = new Error('migration failed');
    const dataSource = {
      initialize: vi.fn().mockResolvedValue(undefined),
      runMigrations: vi.fn().mockRejectedValue(migrationError),
      destroy: vi.fn().mockResolvedValue(undefined),
      get isInitialized() {
        return this.initialize.mock.calls.length > 0;
      },
    };

    await expect(runMigrations(dataSource)).rejects.toBe(migrationError);
    expect(dataSource.destroy).toHaveBeenCalledOnce();
  });

  it('does not destroy a data source that failed before initialization', async () => {
    const dataSource = {
      initialize: vi.fn().mockRejectedValue(new Error('connection failed')),
      runMigrations: vi.fn(),
      destroy: vi.fn(),
      isInitialized: false,
    };

    await expect(runMigrations(dataSource)).rejects.toThrow(
      'connection failed',
    );
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
    expect(dataSource.destroy).not.toHaveBeenCalled();
  });
});
