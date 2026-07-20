import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { AuditLog } from '../database/entities/audit-log.entity.js';

/**
 * Structured audit log of privileged back-office mutations. Used by every
 * administrative endpoint (catalog, Banner, order status). Persists a JSON
 * `changeSummary` payload so reviewers can diff state changes without
 * rebuilding them from related tables.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async record(
    entry: {
      adminUserId: string;
      targetEntity: string;
      targetId: string;
      action: string;
      changeSummary?: Record<string, unknown> | null;
    },
    persistence?: EntityManager | Repository<AuditLog>,
  ): Promise<AuditLog> {
    const auditLogs = persistence
      ? 'getRepository' in persistence
        ? persistence.getRepository(AuditLog)
        : persistence
      : this.auditLogs;
    return auditLogs.save(
      auditLogs.create({
        adminUserId: entry.adminUserId,
        targetEntity: entry.targetEntity,
        targetId: entry.targetId,
        action: entry.action,
        changeSummary: entry.changeSummary ?? null,
      }),
    );
  }
}
