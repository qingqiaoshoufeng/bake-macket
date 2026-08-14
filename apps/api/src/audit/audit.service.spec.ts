import { describe, expect, it, vi } from 'vitest';

import { AuditLog } from '../database/entities/audit-log.entity.js';
import { AuditService, type AuditActor } from './audit.service.js';

const entry = {
  actor: { type: 'ADMIN', adminUserId: 'admin-1' } as const,
  targetEntity: 'banners',
  targetId: 'banner-1',
  action: 'BANNER_CREATED',
};

const buildRepository = () => ({
  create: vi.fn((value: Record<string, unknown>) => value),
  save: vi.fn(async (value: Record<string, unknown>) => value),
});

const recordActor = async (actor: AuditActor) => {
  const repository = buildRepository();
  const service = new AuditService(repository as never);

  await service.record({ ...entry, actor });

  return repository;
};

describe('AuditService', () => {
  it('将 ADMIN actor 仅映射到 adminUserId', async () => {
    const repository = await recordActor({
      type: 'ADMIN',
      adminUserId: 'admin-1',
    });

    expect(repository.save).toHaveBeenCalledWith({
      actorType: 'ADMIN',
      adminUserId: 'admin-1',
      userId: null,
      targetEntity: 'banners',
      targetId: 'banner-1',
      action: 'BANNER_CREATED',
      changeSummary: null,
    });
  });

  it('将 USER actor 仅映射到 userId', async () => {
    const repository = await recordActor({ type: 'USER', userId: 'user-1' });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'USER',
        adminUserId: null,
        userId: 'user-1',
      }),
    );
  });

  it('将 SYSTEM actor 映射为空身份列而不冒充管理员', async () => {
    const repository = await recordActor({ type: 'SYSTEM' });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'SYSTEM',
        adminUserId: null,
        userId: null,
      }),
    );
  });

  it('records with a caller-provided transaction manager', async () => {
    const defaultRepository = buildRepository();
    const transactionRepository = buildRepository();
    const manager = {
      getRepository: vi.fn().mockReturnValue(transactionRepository),
    };
    const service = new AuditService(defaultRepository as never);

    await service.record(entry, manager as never);

    expect(manager.getRepository).toHaveBeenCalledWith(AuditLog);
    expect(transactionRepository.save).toHaveBeenCalledOnce();
    expect(defaultRepository.save).not.toHaveBeenCalled();
  });

  it('records with a caller-provided transaction repository', async () => {
    const defaultRepository = buildRepository();
    const transactionRepository = buildRepository();
    const service = new AuditService(defaultRepository as never);

    await service.record(entry, transactionRepository as never);

    expect(transactionRepository.save).toHaveBeenCalledOnce();
    expect(defaultRepository.save).not.toHaveBeenCalled();
  });
});
