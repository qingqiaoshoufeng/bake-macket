import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import {
  AuditActorType,
  AuditLog,
} from '../database/entities/audit-log.entity.js';

export type AuditActor =
  | { type: 'ADMIN'; adminUserId: string }
  | { type: 'USER'; userId: string }
  | { type: 'SYSTEM' };

type AuditEntry = {
  actor: AuditActor;
  targetEntity: string;
  targetId: string;
  action: string;
  changeSummary?: Record<string, unknown> | null;
};

const actorColumns = (
  actor: AuditActor,
): Pick<AuditLog, 'actorType' | 'adminUserId' | 'userId'> => {
  switch (actor.type) {
    case 'ADMIN':
      return {
        actorType: AuditActorType.ADMIN,
        adminUserId: actor.adminUserId,
        userId: null,
      };
    case 'USER':
      return {
        actorType: AuditActorType.USER,
        adminUserId: null,
        userId: actor.userId,
      };
    case 'SYSTEM':
      return {
        actorType: AuditActorType.SYSTEM,
        adminUserId: null,
        userId: null,
      };
  }
};

/** Persists structured audit records with an explicit, non-ambiguous actor. */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogs: Repository<AuditLog>,
  ) {}

  async record(
    entry: AuditEntry,
    persistence?: EntityManager | Repository<AuditLog>,
  ): Promise<AuditLog> {
    const auditLogs = persistence
      ? 'getRepository' in persistence
        ? persistence.getRepository(AuditLog)
        : persistence
      : this.auditLogs;
    return auditLogs.save(
      auditLogs.create({
        ...actorColumns(entry.actor),
        targetEntity: entry.targetEntity,
        targetId: entry.targetId,
        action: entry.action,
        changeSummary: entry.changeSummary ?? null,
      }),
    );
  }
}
