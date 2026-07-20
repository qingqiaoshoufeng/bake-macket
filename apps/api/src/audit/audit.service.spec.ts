import { describe, expect, it, vi } from 'vitest';

import { AuditLog } from '../database/entities/audit-log.entity.js';
import { AuditService } from './audit.service.js';

const entry = {
  adminUserId: 'admin-1',
  targetEntity: 'banners',
  targetId: 'banner-1',
  action: 'BANNER_CREATED',
};

const buildRepository = () => ({
  create: vi.fn((value: Record<string, unknown>) => value),
  save: vi.fn(async (value: Record<string, unknown>) => value),
});

describe('AuditService', () => {
  it('keeps the original record(entry) repository API', async () => {
    const repository = buildRepository();
    const service = new AuditService(repository as never);

    await service.record(entry);

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ ...entry, changeSummary: null }),
    );
  });

  it('records with a caller-provided transaction manager', async () => {
    const defaultRepository = buildRepository();
    const transactionRepository = buildRepository();
    const manager = {
      getRepository: vi.fn().mockReturnValue(transactionRepository),
    };
    const service = new AuditService(defaultRepository as never);

    await (
      service.record as unknown as (
        auditEntry: typeof entry,
        persistence: typeof manager,
      ) => Promise<unknown>
    )(entry, manager);

    expect(manager.getRepository).toHaveBeenCalledWith(AuditLog);
    expect(transactionRepository.save).toHaveBeenCalledOnce();
    expect(defaultRepository.save).not.toHaveBeenCalled();
  });

  it('records with a caller-provided transaction repository', async () => {
    const defaultRepository = buildRepository();
    const transactionRepository = buildRepository();
    const service = new AuditService(defaultRepository as never);

    await (
      service.record as unknown as (
        auditEntry: typeof entry,
        persistence: typeof transactionRepository,
      ) => Promise<unknown>
    )(entry, transactionRepository);

    expect(transactionRepository.save).toHaveBeenCalledOnce();
    expect(defaultRepository.save).not.toHaveBeenCalled();
  });
});
