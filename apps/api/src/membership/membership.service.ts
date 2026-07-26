import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  ApiErrorCode,
  MembershipLevelStatus,
  type AdminMembershipLevelDetailView,
  type AdminMembershipLevelListItem,
  type AdminMembershipLevelListQuery,
  type PublicMembershipLevelView,
  type SaveMembershipLevelRequest,
} from '@bake-mall/contracts';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { MembershipLevel } from '../database/entities/membership-level.entity.js';
import { MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';

@Injectable()
export class MembershipService {
  constructor(
    @InjectRepository(MembershipLevel)
    private readonly levels: Repository<MembershipLevel>,
    @InjectRepository(MembershipPurchaseOrder)
    private readonly purchases: Repository<MembershipPurchaseOrder>,
    private readonly audit: AuditService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async listPublicLevels(): Promise<PublicMembershipLevelView[]> {
    const levels = await this.levels.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
    return levels.map((level) => this.toPublicView(level));
  }

  async getPublicLevel(id: string): Promise<PublicMembershipLevelView> {
    const level = await this.levels.findOneBy({ id, isActive: true });
    if (!level) throw this.levelNotFound();
    return this.toPublicView(level);
  }

  async listAdminLevels(
    query: AdminMembershipLevelListQuery = {},
  ): Promise<AdminMembershipLevelListItem[]> {
    const levels = await this.levels.find({
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
    const normalizedQuery = query.q?.trim().toLowerCase();
    const filtered = levels.filter(
      (level) =>
        (query.status === undefined || this.statusOf(level) === query.status) &&
        (!normalizedQuery ||
          level.code.toLowerCase().includes(normalizedQuery) ||
          level.name.toLowerCase().includes(normalizedQuery)),
    );
    return Promise.all(filtered.map((level) => this.toAdminView(level)));
  }

  async getAdminLevel(id: string): Promise<AdminMembershipLevelDetailView> {
    return this.toAdminView(await this.requireLevel(id));
  }

  async createLevel(
    request: SaveMembershipLevelRequest,
    adminUserId: string,
  ): Promise<AdminMembershipLevelDetailView> {
    this.assertRequestIsValid(request);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const levels = manager.getRepository(MembershipLevel);
        const created = await levels.save(
          levels.create(this.toPersistence(request)),
        );
        await this.audit.record(
          {
            adminUserId,
            targetEntity: 'membership_levels',
            targetId: created.id,
            action: 'MEMBERSHIP_LEVEL_CREATED',
            changeSummary: this.toAuditSummary(created),
          },
          manager,
        );
        return this.toAdminView(created, manager);
      });
    } catch (error) {
      throw this.translateDuplicateLevel(error, request);
    }
  }

  async updateLevel(
    id: string,
    request: SaveMembershipLevelRequest,
    adminUserId: string,
  ): Promise<AdminMembershipLevelDetailView> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const levels = manager.getRepository(MembershipLevel);
        const existing = await this.requireLevel(id, levels);
        this.assertVersion(existing, request.version);
        this.assertRequestIsValid(request);
        if (request.code !== existing.code) {
          throw new UnprocessableEntityException('会员等级编码创建后不可修改');
        }
        const before = this.toAuditSummary(existing);
        const update = await levels.update(
          { id, version: request.version },
          this.toPersistence(request),
        );
        if (update.affected !== 1) throw this.versionConflict();
        const saved = await this.requireLevel(id, levels);
        await this.audit.record(
          {
            adminUserId,
            targetEntity: 'membership_levels',
            targetId: saved.id,
            action: 'MEMBERSHIP_LEVEL_UPDATED',
            changeSummary: { before, after: this.toAuditSummary(saved) },
          },
          manager,
        );
        return this.toAdminView(saved, manager);
      });
    } catch (error) {
      throw this.translateDuplicateLevel(error, request);
    }
  }

  async updateLevelStatus(
    id: string,
    status: MembershipLevelStatus,
    version: number,
    adminUserId: string,
  ): Promise<AdminMembershipLevelDetailView> {
    const level = await this.requireLevel(id);
    return this.updateLevel(
      id,
      {
        ...this.toSaveRequest(level),
        status,
        version,
      },
      adminUserId,
    );
  }

  async deleteLevel(id: string, adminUserId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const levels = manager.getRepository(MembershipLevel);
      const purchases = manager.getRepository(MembershipPurchaseOrder);
      const level = await levels.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!level) throw this.levelNotFound();
      if (
        this.statusOf(level) !== MembershipLevelStatus.INACTIVE ||
        (await purchases.count({ where: { membershipLevelId: id } })) > 0
      ) {
        throw this.soldLevelCannotBeDeleted();
      }
      let result;
      try {
        result = await levels.delete(id);
      } catch (error) {
        if (this.isReferencedRowError(error))
          throw this.soldLevelCannotBeDeleted();
        throw error;
      }
      if (!result.affected) throw this.levelNotFound();
      await this.audit.record(
        {
          adminUserId,
          targetEntity: 'membership_levels',
          targetId: id,
          action: 'MEMBERSHIP_LEVEL_DELETED',
          changeSummary: this.toAuditSummary(level),
        },
        manager,
      );
    });
  }

  private async toAdminView(
    level: MembershipLevel,
    manager?: EntityManager,
  ): Promise<AdminMembershipLevelDetailView> {
    const purchases =
      manager?.getRepository(MembershipPurchaseOrder) ?? this.purchases;
    return {
      ...this.toPublicView(level),
      status: this.statusOf(level),
      version: level.version,
      purchaseCount: await purchases.count({
        where: { membershipLevelId: level.id },
      }),
      createdAt: level.createdAt.toISOString(),
      updatedAt: level.updatedAt.toISOString(),
    };
  }

  private toPublicView(level: MembershipLevel): PublicMembershipLevelView {
    return {
      id: level.id,
      code: level.code,
      name: level.name,
      ...(level.subtitle ? { subtitle: level.subtitle } : {}),
      ...(level.description ? { description: level.description } : {}),
      rank: level.rank,
      priceCents: level.priceCents,
      grantCreditCents: level.grantCreditCents,
      discountBasisPoints: level.discountBasisPoints,
      validDays: level.validDays,
      benefits: level.benefits,
      cardTheme: { theme: level.theme, badgeText: level.badgeText },
      sortOrder: level.sortOrder,
    };
  }

  private toSaveRequest(level: MembershipLevel): SaveMembershipLevelRequest {
    return {
      ...this.toPublicView(level),
      cardTheme: { theme: level.theme, badgeText: level.badgeText },
      status: this.statusOf(level),
      version: level.version,
    };
  }

  private toPersistence(request: SaveMembershipLevelRequest) {
    return {
      code: request.code,
      name: request.name,
      subtitle: request.subtitle ?? null,
      description: request.description ?? null,
      rank: request.rank,
      priceCents: request.priceCents,
      grantCreditCents: request.grantCreditCents,
      discountBasisPoints: request.discountBasisPoints,
      validDays: request.validDays,
      benefits: request.benefits,
      theme: request.cardTheme.theme,
      badgeText: request.cardTheme.badgeText,
      sortOrder: request.sortOrder,
      isActive: request.status === MembershipLevelStatus.ACTIVE,
    };
  }

  private assertRequestIsValid(request: SaveMembershipLevelRequest): void {
    const intUnsignedMax = 4_294_967_295;
    const numericFields = [
      request.rank,
      request.priceCents,
      request.grantCreditCents,
      request.sortOrder,
      ...request.benefits.map(({ sortOrder }) => sortOrder),
    ];
    if (
      numericFields.some(
        (value) =>
          !Number.isSafeInteger(value) || value < 0 || value > intUnsignedMax,
      )
    ) {
      throw new UnprocessableEntityException('会员等级数值超出允许范围');
    }
    if (
      request.status === MembershipLevelStatus.ACTIVE &&
      request.benefits.length === 0
    ) {
      throw new UnprocessableEntityException('上架会员等级至少需要一条权益');
    }
  }

  private toAuditSummary(level: MembershipLevel): Record<string, unknown> {
    return {
      code: level.code,
      name: level.name,
      rank: level.rank,
      priceCents: level.priceCents,
      grantCreditCents: level.grantCreditCents,
      discountBasisPoints: level.discountBasisPoints,
      validDays: level.validDays,
      isActive: level.isActive,
      version: level.version,
    };
  }

  private statusOf(level: MembershipLevel): MembershipLevelStatus {
    return level.isActive
      ? MembershipLevelStatus.ACTIVE
      : MembershipLevelStatus.INACTIVE;
  }

  private assertVersion(
    level: MembershipLevel,
    version: number | undefined,
  ): void {
    if (version !== level.version) throw this.versionConflict();
  }

  private versionConflict(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.MEMBERSHIP_LEVEL_VERSION_CONFLICT,
      message: '会员等级已被其他操作更新，请刷新后重试',
    });
  }

  private translateDuplicateLevel(
    error: unknown,
    request: SaveMembershipLevelRequest,
  ): unknown {
    if (!this.isMysqlError(error, 1062, 'ER_DUP_ENTRY')) return error;
    const message = this.mysqlError(error as QueryFailedError).sqlMessage ?? '';
    const duplicateRank = message.includes('uniq_membership_levels_rank');
    return new ConflictException({
      code: ApiErrorCode.MEMBERSHIP_LEVEL_CONFLICT,
      message: duplicateRank ? '会员等级排序等级已存在' : '会员等级编码已存在',
      details: duplicateRank ? { rank: request.rank } : { code: request.code },
    });
  }

  private isReferencedRowError(error: unknown): boolean {
    return this.isMysqlError(error, 1451, 'ER_ROW_IS_REFERENCED_2');
  }

  private isMysqlError(error: unknown, errno: number, code: string): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = this.mysqlError(error);
    return driverError.errno === errno || driverError.code === code;
  }

  private mysqlError(error: QueryFailedError): {
    code?: string;
    errno?: number;
    sqlMessage?: string;
  } {
    return error.driverError as {
      code?: string;
      errno?: number;
      sqlMessage?: string;
    };
  }

  private soldLevelCannotBeDeleted(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      message: '已售会员等级不可删除，请改为下架',
    });
  }

  private async requireLevel(
    id: string,
    repository: Repository<MembershipLevel> = this.levels,
  ): Promise<MembershipLevel> {
    const level = await repository.findOneBy({ id });
    if (!level) throw this.levelNotFound();
    return level;
  }

  private levelNotFound(): NotFoundException {
    return new NotFoundException({
      code: ApiErrorCode.MEMBERSHIP_LEVEL_NOT_FOUND,
      message: '会员等级不存在',
    });
  }
}
