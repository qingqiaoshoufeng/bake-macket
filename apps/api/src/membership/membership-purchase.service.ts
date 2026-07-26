import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  ApiErrorCode,
  MembershipEntitlementSegmentKind,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipPurchaseVoidReasonCode,
  MembershipStatus,
  type AdminMembershipPurchaseDetailView,
  type AdminMembershipPurchaseListQuery,
  type AdminMembershipPurchaseListResult,
  type AdminMemberCreditEntryView,
  type AdminMemberCreditGrantView,
  type AdminMembershipRecordView,
  type CreateMembershipPurchaseRequest,
  type MemberCreditEntryView,
  type MembershipEntitlementSegmentView,
  type MembershipOverviewView,
  type MembershipPurchaseView,
  type MembershipPurchaseVoidability,
  type PublicMembershipLevelView,
} from '@bake-mall/contracts';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service.js';
import { type AppConfig } from '../config/env.schema.js';
import { IdempotencyRecord } from '../database/entities/idempotency-record.entity.js';
import { MemberAccount } from '../database/entities/member-account.entity.js';
import { MemberCreditEntry } from '../database/entities/member-credit-entry.entity.js';
import { MemberCreditGrant } from '../database/entities/member-credit-grant.entity.js';
import { MembershipEntitlementSegment } from '../database/entities/membership-entitlement-segment.entity.js';
import { MembershipLevel } from '../database/entities/membership-level.entity.js';
import { Order } from '../database/entities/order.entity.js';
import {
  MembershipPaymentChannel,
  MembershipPurchaseOrder,
} from '../database/entities/membership-purchase-order.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';
import { User } from '../database/entities/user.entity.js';
import { MembershipCreditService } from './membership-credit.service.js';
import { MembershipEntitlementService } from './membership-entitlement.service.js';

export const MEMBERSHIP_PURCHASE_CLOCK = Symbol('MEMBERSHIP_PURCHASE_CLOCK');

@Injectable()
export class MembershipPurchaseService {
  constructor(
    @InjectRepository(MembershipPurchaseOrder)
    private readonly purchases: Repository<MembershipPurchaseOrder>,
    @InjectRepository(MembershipLevel)
    private readonly levels: Repository<MembershipLevel>,
    @InjectRepository(MemberAccount)
    private readonly accounts: Repository<MemberAccount>,
    @InjectRepository(UserMembership)
    private readonly memberships: Repository<UserMembership>,
    @InjectRepository(MemberCreditGrant)
    private readonly grants: Repository<MemberCreditGrant>,
    @InjectRepository(MemberCreditEntry)
    private readonly entries: Repository<MemberCreditEntry>,
    @InjectRepository(IdempotencyRecord)
    private readonly idempotency: Repository<IdempotencyRecord>,
    @InjectRepository(MembershipEntitlementSegment)
    private readonly segments: Repository<MembershipEntitlementSegment>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly entitlement: MembershipEntitlementService,
    private readonly credit: MembershipCreditService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
    @Optional()
    @Inject(MEMBERSHIP_PURCHASE_CLOCK)
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async createPurchase(
    userId: string,
    idempotencyKey: string,
    request: CreateMembershipPurchaseRequest,
  ): Promise<MembershipPurchaseView> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const requestHash = this.requestHash(request);
    const previous = await this.purchases.findOneBy({ userId, idempotencyKey });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw this.idempotencyConflict();
      return this.toView(previous);
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const levels = manager.getRepository(MembershipLevel);
        const purchases = manager.getRepository(MembershipPurchaseOrder);
        const level = await levels.findOneBy({ id: request.levelId });
        if (!level) throw this.levelNotFound();
        if (!level.isActive) {
          throw new ConflictException({
            code: ApiErrorCode.MEMBERSHIP_LEVEL_INACTIVE,
            message: '会员等级暂不可购买',
          });
        }
        const duplicate = await purchases.findOneBy({ userId, idempotencyKey });
        if (duplicate) {
          if (duplicate.requestHash !== requestHash)
            throw this.idempotencyConflict();
          return this.toView(duplicate);
        }
        const purchase = await purchases.save(
          purchases.create({
            purchaseNo: this.purchaseNo(),
            userId,
            membershipLevelId: level.id,
            levelCode: level.code,
            levelName: level.name,
            levelRank: level.rank,
            priceCents: level.priceCents,
            grantCreditCents: level.grantCreditCents,
            discountBasisPoints: level.discountBasisPoints,
            validDays: level.validDays,
            benefits: level.benefits,
            theme: level.theme,
            badgeText: level.badgeText,
            status: MembershipPurchaseStatus.PENDING,
            paymentStatus: MembershipPaymentStatus.PENDING,
            paymentChannel: MembershipPaymentChannel.SIMULATED,
            idempotencyKey,
            requestHash,
            paidAt: null,
            voidedAt: null,
          }),
        );
        return this.toView(purchase);
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const raced = await this.purchases.findOneBy({ userId, idempotencyKey });
      if (!raced) throw error;
      if (raced.requestHash !== requestHash) throw this.idempotencyConflict();
      return this.toView(raced);
    }
  }

  async simulatePayment(
    userId: string,
    purchaseId: string,
    idempotencyKey: string,
  ): Promise<MembershipPurchaseView> {
    this.assertSimulatedPaymentEnabled();
    const requestHash = this.requestHash({ purchaseId });
    const existing = await this.idempotency.findOneBy({
      userId,
      operation: 'MEMBERSHIP_PURCHASE_SIMULATE_PAYMENT',
      key: idempotencyKey,
    });
    if (existing) return this.resolvePaymentIdempotency(existing, requestHash);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const purchases = manager.getRepository(MembershipPurchaseOrder);
        const idempotency = manager.getRepository(IdempotencyRecord);
        const levels = manager.getRepository(MembershipLevel);
        const users = manager.getRepository(User);
        await users.findOne({
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });
        const account = await this.credit.lockOrCreateAccount(manager, userId);
        const purchase = await purchases.findOne({
          where: { id: purchaseId, userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!purchase) throw this.purchaseNotFound();
        const record = await idempotency.save(
          idempotency.create({
            userId,
            operation: 'MEMBERSHIP_PURCHASE_SIMULATE_PAYMENT',
            key: idempotencyKey,
            requestHash,
            status: 'IN_PROGRESS',
            resourceType: null,
            resourceId: null,
            responseSnapshot: null,
            orderId: null,
            expiresAt: null,
          }),
        );
        const segmentRepository = manager.getRepository(
          MembershipEntitlementSegment,
        );
        if (purchase.status === MembershipPurchaseStatus.FULFILLED) {
          const segment = await segmentRepository.findOne({
            where: { purchaseOrderId: purchase.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!segment) throw this.entitlementInconsistent();
          const result = this.toView(purchase, segment.membershipId);
          await idempotency.update(
            { id: record.id },
            {
              status: 'COMPLETED',
              resourceType: 'MEMBERSHIP_PURCHASE',
              resourceId: purchase.id,
              responseSnapshot: result,
            },
          );
          return result;
        }
        if (purchase.status !== MembershipPurchaseStatus.PENDING) {
          throw this.purchaseNotPayable();
        }
        const level = await levels.findOne({
          where: { id: purchase.membershipLevelId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!level?.isActive) {
          throw new ConflictException({
            code: ApiErrorCode.MEMBERSHIP_LEVEL_INACTIVE,
            message: '会员等级暂不可购买',
          });
        }
        const application = await this.entitlement.applyPaidPurchase(manager, {
          account,
          purchase,
          now: this.clock(),
        });
        await this.credit.grantMembershipPurchase(
          manager,
          application.account,
          purchase,
        );
        const fulfilled = await purchases.save({
          ...purchase,
          status: MembershipPurchaseStatus.FULFILLED,
          paymentStatus: MembershipPaymentStatus.SUCCEEDED,
          paidAt: this.clock(),
        });
        const result = this.toView(fulfilled, application.membership.id);
        await idempotency.update(
          { id: record.id },
          {
            status: 'COMPLETED',
            resourceType: 'MEMBERSHIP_PURCHASE',
            resourceId: purchase.id,
            responseSnapshot: result,
          },
        );
        return result;
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const raced = await this.idempotency.findOneBy({
        userId,
        operation: 'MEMBERSHIP_PURCHASE_SIMULATE_PAYMENT',
        key: idempotencyKey,
      });
      if (!raced) throw error;
      return this.resolvePaymentIdempotency(raced, requestHash);
    }
  }

  async voidPurchase(
    purchaseId: string,
    adminUserId: string,
  ): Promise<AdminMembershipPurchaseDetailView> {
    const voided = await this.dataSource.transaction(async (manager) => {
      const purchases = manager.getRepository(MembershipPurchaseOrder);
      const accounts = manager.getRepository(MemberAccount);
      const memberships = manager.getRepository(UserMembership);
      const segments = manager.getRepository(MembershipEntitlementSegment);
      const orders = manager.getRepository(Order);
      const users = manager.getRepository(User);

      // Unlocked read only to discover the userId we need to lock.
      const initialPurchase = await purchases.findOneBy({ id: purchaseId });
      if (!initialPurchase) throw this.purchaseNotVoidable();

      // Lock order: user -> account -> purchase -> membership -> segment.
      await users.findOne({
        where: { id: initialPurchase.userId },
        lock: { mode: 'pessimistic_write' },
      });
      const account = await accounts.findOne({
        where: { userId: initialPurchase.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) throw this.purchaseNotVoidable();
      const purchase = await purchases.findOne({
        where: { id: purchaseId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!purchase || purchase.status !== MembershipPurchaseStatus.FULFILLED) {
        throw this.purchaseNotVoidable();
      }

      // Discover the immutable segment and target membership without locks so
      // every membership row can then be locked in one deterministic ID order.
      const discoveredSegment = await segments.findOneBy({
        purchaseOrderId: purchase.id,
      });
      if (!discoveredSegment) throw this.purchaseNotVoidable();
      const discoveredMembership = await memberships.findOneBy({
        id: discoveredSegment.membershipId,
      });
      if (!discoveredMembership) throw this.purchaseNotVoidable();
      const previousMembershipId =
        discoveredSegment.kind === MembershipEntitlementSegmentKind.UPGRADE
          ? discoveredSegment.previousMembershipId
          : discoveredSegment.kind === MembershipEntitlementSegmentKind.INITIAL
            ? discoveredMembership.previousMembershipId
            : null;
      const lockedMemberships = await this.lockMembershipsById(
        memberships,
        [discoveredMembership.id, previousMembershipId].filter(
          (id): id is string => id !== null,
        ),
      );
      const membership = lockedMemberships.get(discoveredMembership.id);
      const previousMembership = previousMembershipId
        ? lockedMemberships.get(previousMembershipId)
        : null;
      if (
        !membership ||
        membership.userId !== purchase.userId ||
        (previousMembershipId && !previousMembership)
      ) {
        throw this.purchaseNotVoidable();
      }
      const segment = await segments.findOne({
        where: { id: discoveredSegment.id, purchaseOrderId: purchase.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !segment ||
        segment.membershipId !== membership.id ||
        segment.kind !== discoveredSegment.kind ||
        segment.membershipId !== discoveredSegment.membershipId ||
        segment.previousMembershipId !==
          discoveredSegment.previousMembershipId ||
        (segment.previousMembershipEndsAt?.getTime() ?? null) !==
          (discoveredSegment.previousMembershipEndsAt?.getTime() ?? null) ||
        (segment.kind === MembershipEntitlementSegmentKind.INITIAL &&
          membership.previousMembershipId !== previousMembershipId)
      ) {
        throw this.purchaseNotVoidable();
      }

      // Re-verify voidability under the locks we now hold.
      // 1. The target membership must still be the account's global chain tail.
      //    A membership-local tail is stale after a later upgrade.
      if (account.activeMembershipId !== membership.id) {
        throw this.purchaseNotVoidable();
      }
      // 2. The purchase's segment must be the membership-local chain tail (no
      //    later segment extends it), otherwise voiding would leave a time gap.
      const tail = await segments.findOne({
        where: { membershipId: membership.id },
        order: { endsAt: 'DESC', id: 'DESC' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tail || tail.id !== segment.id) {
        throw this.purchaseNotVoidable();
      }
      // 3. No order may have consumed this membership's discount snapshot.
      if (await orders.existsBy({ membershipId: membership.id })) {
        throw this.purchaseNotVoidable();
      }

      // Delegate credit reversal (locks grant + original grant entry, writes
      // the reversal entry, updates account balance; idempotent on operationKey
      // and refuses when the grant has been partially used).
      const reversed = await this.credit.reverseUnusedMembershipPurchaseGrant(
        manager,
        account,
        purchase,
      );
      // Delegate membership time-line restore using only the membership rows
      // locked above; no membership lock may be acquired after credit locks.
      await this.entitlement.restoreVoidedPurchase(manager, {
        account: reversed.account,
        purchase,
        segment,
        targetMembership: membership,
        previousMembership: previousMembership ?? null,
        now: this.clock(),
      });

      const voided = await purchases.save({
        ...purchase,
        status: MembershipPurchaseStatus.VOIDED,
        paymentStatus: MembershipPaymentStatus.REVERSED,
        voidedAt: this.clock(),
      });
      await this.audit.record(
        {
          adminUserId,
          targetEntity: 'membership_purchase_orders',
          targetId: purchase.id,
          action: 'MEMBERSHIP_PURCHASE_VOIDED',
          changeSummary: {
            purchaseNo: purchase.purchaseNo,
            amountCents: purchase.grantCreditCents,
          },
        },
        manager,
      );
      return voided;
    });
    // Read the full detail outside the transaction so the reversal entry and
    // REVERSED grant written by the credit service within the transaction are
    // committed and visible to the detail mapper.
    return this.toAdminDetailView(voided);
  }

  async getOverview(userId: string): Promise<MembershipOverviewView> {
    const [account, levels] = await Promise.all([
      this.accounts.findOneBy({ userId }),
      this.levels.find({
        where: { isActive: true },
        order: { sortOrder: 'ASC' },
      }),
    ]);
    const currentMembership = account?.activeMembershipId
      ? await this.memberships.findOneBy({ id: account.activeMembershipId })
      : null;
    const now = this.clock();
    return {
      currentMembership: this.isValidMembership(currentMembership, now)
        ? {
            id: currentMembership.id,
            levelId: currentMembership.membershipLevelId,
            code: currentMembership.levelCode,
            name: currentMembership.levelName,
            rank: currentMembership.levelRank,
            discountBasisPoints: currentMembership.discountBasisPoints,
            startsAt: currentMembership.startsAt.toISOString(),
            endsAt: currentMembership.endsAt.toISOString(),
            status: currentMembership.status,
            cardTheme: {
              theme: currentMembership.theme,
              badgeText: currentMembership.badgeText,
            },
            benefits: currentMembership.benefits,
          }
        : null,
      account: {
        availableCreditCents: account?.availableCreditCents ?? 0,
        version: account?.version ?? 1,
      },
      levels: levels.map((level): PublicMembershipLevelView => ({
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
      })),
      simulatedPaymentEnabled: this.simulatedPaymentEnabled(),
    };
  }

  async listPurchases(userId: string): Promise<MembershipPurchaseView[]> {
    const purchases = await this.purchases.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return purchases.map((purchase) => this.toView(purchase));
  }

  async getAdminPurchase(
    purchaseId: string,
  ): Promise<AdminMembershipPurchaseDetailView> {
    const purchase = await this.purchases.findOneBy({ id: purchaseId });
    if (!purchase) throw this.purchaseNotFound();
    return this.toAdminDetailView(purchase);
  }

  async listAdminPurchases(
    query: AdminMembershipPurchaseListQuery,
  ): Promise<AdminMembershipPurchaseListResult> {
    const purchases = await this.purchases.find({
      order: { createdAt: 'DESC' },
    });
    const filtered = purchases.filter((purchase) => {
      const createdAt = purchase.createdAt.toISOString();
      return (
        (!query.purchaseNo || purchase.purchaseNo.includes(query.purchaseNo)) &&
        (!query.userId || purchase.userId === query.userId) &&
        (!query.levelId || purchase.membershipLevelId === query.levelId) &&
        (!query.status || purchase.status === query.status) &&
        (!query.createdAtFrom || createdAt >= query.createdAtFrom) &&
        (!query.createdAtBefore || createdAt <= query.createdAtBefore)
      );
    });
    const start = (query.page - 1) * query.pageSize;
    const items = await Promise.all(
      filtered.slice(start, start + query.pageSize).map(async (purchase) => ({
        ...this.toView(purchase),
        userId: purchase.userId,
        voidability: await this.voidabilityOf(purchase),
      })),
    );
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
    };
  }

  async listCreditEntries(userId: string): Promise<MemberCreditEntryView[]> {
    const account = await this.accounts.findOneBy({ userId });
    if (!account) return [];
    const entries = await this.entries.find({
      where: { accountId: account.id },
      order: { createdAt: 'DESC' },
    });
    return entries.map((entry) => ({
      id: entry.id,
      direction: entry.direction,
      type: entry.type,
      amountCents: entry.amountCents,
      balanceAfterCents: entry.balanceAfterCents,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  private async voidabilityOf(
    purchase: MembershipPurchaseOrder,
  ): Promise<MembershipPurchaseVoidability> {
    if (purchase.status !== MembershipPurchaseStatus.FULFILLED) {
      return {
        allowed: false,
        reasonCode: MembershipPurchaseVoidReasonCode.PURCHASE_NOT_FULFILLED,
        reason: '购卡单未完成或已作废',
      };
    }
    const [grant, account, segment] = await Promise.all([
      this.grants.findOneBy({ purchaseOrderId: purchase.id }),
      this.accounts.findOneBy({ userId: purchase.userId }),
      this.segments.findOneBy({ purchaseOrderId: purchase.id }),
    ]);
    if (
      purchase.grantCreditCents > 0 &&
      (!grant || grant.remainingCents !== grant.grantedCents)
    ) {
      return {
        allowed: false,
        reasonCode: MembershipPurchaseVoidReasonCode.CREDIT_USED,
        reason: '赠送消费金已被使用',
      };
    }
    if (!account || !segment) {
      return {
        allowed: false,
        reasonCode:
          MembershipPurchaseVoidReasonCode.MEMBERSHIP_CHAIN_NOT_RESTORABLE,
        reason: '当前会员链无法恢复',
      };
    }
    const membership = await this.memberships.findOneBy({
      id: segment.membershipId,
    });
    if (!membership || account.activeMembershipId !== membership.id) {
      return {
        allowed: false,
        reasonCode:
          MembershipPurchaseVoidReasonCode.MEMBERSHIP_CHAIN_NOT_RESTORABLE,
        reason: '当前购卡记录已不是全局会员链末端，无法恢复',
      };
    }
    const tail = await this.segments.findOne({
      where: { membershipId: membership.id },
      order: { endsAt: 'DESC', id: 'DESC' },
    });
    if (!tail || tail.id !== segment.id) {
      return {
        allowed: false,
        reasonCode: MembershipPurchaseVoidReasonCode.SEGMENT_NOT_CHAIN_TAIL,
        reason: '购卡记录不是当前会员链末端',
      };
    }
    if (await this.orders.existsBy({ membershipId: membership.id })) {
      return {
        allowed: false,
        reasonCode: MembershipPurchaseVoidReasonCode.MEMBERSHIP_BENEFIT_USED,
        reason: '会员折扣权益已被使用',
      };
    }
    return { allowed: true };
  }

  private async lockMembershipsById(
    memberships: Repository<UserMembership>,
    membershipIds: string[],
  ): Promise<Map<string, UserMembership>> {
    const orderedIds = [...new Set(membershipIds)].sort((left, right) =>
      left.localeCompare(right),
    );
    const lockedMemberships = await orderedIds.reduce(
      async (pending, membershipId) => {
        const collected = await pending;
        const membership = await memberships.findOne({
          where: { id: membershipId },
          lock: { mode: 'pessimistic_write' },
        });
        return membership ? [...collected, membership] : collected;
      },
      Promise.resolve([] as UserMembership[]),
    );
    return new Map(
      lockedMemberships.map((membership) => [membership.id, membership]),
    );
  }

  private assertSimulatedPaymentEnabled(): void {
    if (!this.simulatedPaymentEnabled()) {
      throw new ForbiddenException({
        code: ApiErrorCode.SIMULATED_PAYMENT_DISABLED,
        message: '当前环境不支持模拟支付',
      });
    }
  }

  private simulatedPaymentEnabled(): boolean {
    const env = this.config.get('appEnv', { infer: true });
    return env.NODE_ENV !== 'production' && env.SIMULATED_PAYMENT_ENABLED;
  }

  private isValidMembership(
    membership: UserMembership | null,
    now: Date,
  ): membership is UserMembership {
    return Boolean(
      membership &&
      membership.status === MembershipStatus.ACTIVE &&
      membership.startsAt <= now &&
      membership.endsAt > now,
    );
  }

  private toView(
    purchase: MembershipPurchaseOrder,
    membershipId?: string,
  ): MembershipPurchaseView {
    return {
      id: purchase.id,
      purchaseNo: purchase.purchaseNo,
      levelId: purchase.membershipLevelId,
      levelCode: purchase.levelCode,
      levelName: purchase.levelName,
      levelRank: purchase.levelRank,
      priceCents: purchase.priceCents,
      grantCreditCents: purchase.grantCreditCents,
      discountBasisPoints: purchase.discountBasisPoints,
      validDays: purchase.validDays,
      cardTheme: { theme: purchase.theme, badgeText: purchase.badgeText },
      status: purchase.status,
      paymentStatus: purchase.paymentStatus,
      ...(membershipId ? { membershipId } : {}),
      ...(purchase.paidAt ? { paidAt: purchase.paidAt.toISOString() } : {}),
      ...(purchase.voidedAt
        ? { voidedAt: purchase.voidedAt.toISOString() }
        : {}),
      createdAt: purchase.createdAt.toISOString(),
      updatedAt: purchase.updatedAt.toISOString(),
    };
  }

  private toPurchaseSnapshot(
    purchase: MembershipPurchaseOrder,
    membershipId: string | null,
  ): AdminMembershipPurchaseDetailView['purchase'] {
    const base = {
      id: purchase.id,
      userId: purchase.userId,
      purchaseNo: purchase.purchaseNo,
      levelId: purchase.membershipLevelId,
      levelCode: purchase.levelCode,
      levelName: purchase.levelName,
      levelRank: purchase.levelRank,
      priceCents: purchase.priceCents,
      grantCreditCents: purchase.grantCreditCents,
      discountBasisPoints: purchase.discountBasisPoints,
      validDays: purchase.validDays,
      benefits: purchase.benefits,
      cardTheme: { theme: purchase.theme, badgeText: purchase.badgeText },
      paymentChannel: purchase.paymentChannel,
      createdAt: purchase.createdAt.toISOString(),
      updatedAt: purchase.updatedAt.toISOString(),
    };
    if (purchase.status === MembershipPurchaseStatus.PENDING) {
      return {
        ...base,
        status: MembershipPurchaseStatus.PENDING,
        paymentStatus: MembershipPaymentStatus.PENDING,
        membershipId: null,
        paidAt: null,
        voidedAt: null,
      };
    }
    const paidAt = purchase.paidAt ? purchase.paidAt.toISOString() : null;
    if (purchase.status === MembershipPurchaseStatus.VOIDED) {
      return {
        ...base,
        status: MembershipPurchaseStatus.VOIDED,
        paymentStatus: MembershipPaymentStatus.REVERSED,
        membershipId: membershipId as string,
        paidAt: paidAt as string,
        voidedAt: purchase.voidedAt
          ? purchase.voidedAt.toISOString()
          : (null as unknown as string),
      };
    }
    return {
      ...base,
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
      membershipId: membershipId as string,
      paidAt: paidAt as string,
      voidedAt: null,
    };
  }

  private async toAdminDetailView(
    purchase: MembershipPurchaseOrder,
  ): Promise<AdminMembershipPurchaseDetailView> {
    const account = await this.accounts.findOneBy({ userId: purchase.userId });
    const [grant, segment, voidability] = await Promise.all([
      purchase.grantCreditCents > 0
        ? this.grants.findOneBy({ purchaseOrderId: purchase.id })
        : Promise.resolve(null),
      purchase.status === MembershipPurchaseStatus.PENDING
        ? Promise.resolve(null)
        : this.segments.findOneBy({ purchaseOrderId: purchase.id }),
      this.voidabilityOf(purchase),
    ]);
    // Membership chain: every membership row the user ever held, newest first.
    const chain = account
      ? await this.memberships.find({
          where: { userId: purchase.userId },
          order: { createdAt: 'DESC', id: 'DESC' },
        })
      : [];
    // Ledger entries tied to this purchase (grant + void reversal). We scope by
    // reference so the Admin detail shows exactly the purchase's own entries.
    const entries = account
      ? await this.entries.find({
          where: {
            accountId: account.id,
            referenceType: 'MEMBERSHIP_PURCHASE',
            referenceId: purchase.id,
          },
          order: { createdAt: 'ASC', id: 'ASC' },
        })
      : [];

    const common = {
      membershipChain: chain.map((m) => this.toMembershipRecordView(m)),
      grant: grant ? this.toGrantView(grant) : null,
      entries: entries.map((e) => this.toAdminEntryView(e)),
      voidability,
    };
    if (purchase.status === MembershipPurchaseStatus.PENDING) {
      return {
        ...common,
        purchase: this.toPurchaseSnapshot(purchase, null) as Extract<
          AdminMembershipPurchaseDetailView['purchase'],
          { status: typeof MembershipPurchaseStatus.PENDING }
        >,
        segment: null,
      };
    }
    if (!segment) {
      throw new Error(
        `missing entitlement segment for purchase ${purchase.id}`,
      );
    }
    return {
      ...common,
      purchase: this.toPurchaseSnapshot(
        purchase,
        segment.membershipId,
      ) as Extract<
        AdminMembershipPurchaseDetailView['purchase'],
        {
          status:
            | typeof MembershipPurchaseStatus.FULFILLED
            | typeof MembershipPurchaseStatus.VOIDED;
        }
      >,
      segment: this.toSegmentView(segment),
    };
  }

  private toMembershipRecordView(
    membership: UserMembership,
  ): AdminMembershipRecordView {
    return {
      id: membership.id,
      userId: membership.userId,
      purchaseOrderId: membership.purchaseOrderId,
      levelId: membership.membershipLevelId,
      levelCode: membership.levelCode,
      levelName: membership.levelName,
      levelRank: membership.levelRank,
      discountBasisPoints: membership.discountBasisPoints,
      benefits: membership.benefits,
      cardTheme: { theme: membership.theme, badgeText: membership.badgeText },
      startsAt: membership.startsAt.toISOString(),
      endsAt: membership.endsAt.toISOString(),
      previousMembershipId: membership.previousMembershipId,
      status: membership.status,
      createdAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString(),
    };
  }

  private toGrantView(grant: MemberCreditGrant): AdminMemberCreditGrantView {
    return {
      id: grant.id,
      accountId: grant.accountId,
      purchaseOrderId: grant.purchaseOrderId,
      grantedCents: grant.grantedCents,
      remainingCents: grant.remainingCents,
      status: grant.status,
      createdAt: grant.createdAt.toISOString(),
      updatedAt: grant.updatedAt.toISOString(),
    };
  }

  private toAdminEntryView(
    entry: MemberCreditEntry,
  ): AdminMemberCreditEntryView {
    return {
      id: entry.id,
      accountId: entry.accountId,
      direction: entry.direction,
      type: entry.type,
      amountCents: entry.amountCents,
      balanceAfterCents: entry.balanceAfterCents,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      operationKey: entry.operationKey,
      reversalOfEntryId: entry.reversalOfEntryId,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private toSegmentView(
    segment: MembershipEntitlementSegment,
  ): MembershipEntitlementSegmentView {
    const base = {
      id: segment.id,
      membershipId: segment.membershipId,
      purchaseOrderId: segment.purchaseOrderId,
      startsAt: segment.startsAt.toISOString(),
      endsAt: segment.endsAt.toISOString(),
      createdAt: segment.createdAt.toISOString(),
    };
    if (segment.kind === MembershipEntitlementSegmentKind.UPGRADE) {
      return {
        ...base,
        kind: MembershipEntitlementSegmentKind.UPGRADE,
        previousMembershipId: segment.previousMembershipId as string,
        previousMembershipEndsAt:
          segment.previousMembershipEndsAt as unknown as string,
      };
    }
    return {
      ...base,
      kind: segment.kind,
      previousMembershipId: null,
      previousMembershipEndsAt: null,
    };
  }

  private purchaseNo(): string {
    return `MP${this.clock()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)}${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  private requestHash(request: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(request)).digest('hex');
  }

  private resolvePaymentIdempotency(
    record: IdempotencyRecord,
    requestHash: string,
  ): MembershipPurchaseView {
    if (record.requestHash !== requestHash) throw this.idempotencyConflict();
    if (record.status !== 'COMPLETED' || !record.responseSnapshot) {
      throw new ConflictException({
        code: ApiErrorCode.IDEMPOTENCY_IN_PROGRESS,
        message: '相同支付请求正在处理中',
      });
    }
    return record.responseSnapshot as unknown as MembershipPurchaseView;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ER_DUP_ENTRY'
    );
  }

  private purchaseNotVoidable(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
      message: '当前购卡记录不满足作废条件',
    });
  }

  private purchaseNotFound(): NotFoundException {
    return new NotFoundException({
      code: ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_FOUND,
      message: '会员购卡单不存在',
    });
  }

  private purchaseNotPayable(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_PAYABLE,
      message: '会员购卡单当前不可支付',
    });
  }

  private entitlementInconsistent(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.MEMBERSHIP_ENTITLEMENT_INCONSISTENT,
      message: '会员购卡单缺少有效期贡献记录',
    });
  }

  private levelNotFound(): NotFoundException {
    return new NotFoundException({
      code: ApiErrorCode.MEMBERSHIP_LEVEL_NOT_FOUND,
      message: '会员等级不存在',
    });
  }

  private idempotencyConflict(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.IDEMPOTENCY_CONFLICT,
      message: 'Idempotency-Key 与请求内容不一致',
    });
  }
}
