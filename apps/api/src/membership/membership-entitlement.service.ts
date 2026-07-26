import { ConflictException, Injectable } from '@nestjs/common';
import {
  ApiErrorCode,
  MembershipEntitlementSegmentKind,
  MembershipStatus,
} from '@bake-mall/contracts';
import { type EntityManager } from 'typeorm';

import { MemberAccount } from '../database/entities/member-account.entity.js';
import { MembershipEntitlementSegment } from '../database/entities/membership-entitlement-segment.entity.js';
import { MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export type MembershipApplicationResult = {
  kind: MembershipEntitlementSegmentKind;
  account: MemberAccount;
  membership: UserMembership;
  segment: MembershipEntitlementSegment;
  replacedMembership: UserMembership | null;
};

export type MembershipRestoreResult = {
  account: MemberAccount;
  /** The membership that becomes the active one after restore (the previous one for upgrade/initial, or the same one for renewal). */
  membership: UserMembership;
  /** The membership that was voided by this restore, if any. */
  voidedMembership: UserMembership | null;
};

@Injectable()
export class MembershipEntitlementService {
  async applyPaidPurchase(
    manager: EntityManager,
    input: {
      account: MemberAccount;
      purchase: MembershipPurchaseOrder;
      now: Date;
    },
  ): Promise<MembershipApplicationResult> {
    const { account, purchase, now } = input;
    const memberships = manager.getRepository(UserMembership);
    const current = account.activeMembershipId
      ? await memberships.findOne({
          where: { id: account.activeMembershipId },
          lock: { mode: 'pessimistic_write' },
        })
      : null;

    if (!current || !this.isActive(current, now)) {
      if (current?.status === MembershipStatus.ACTIVE) {
        await memberships.save({
          ...current,
          status: MembershipStatus.EXPIRED,
        });
      }
      return this.createInitial(manager, account, purchase, now, null);
    }
    if (purchase.levelRank < current.levelRank)
      throw this.downgradeNotAllowed();
    if (purchase.levelRank === current.levelRank) {
      return this.renew(manager, account, purchase, current);
    }
    return this.upgrade(manager, account, purchase, current, now);
  }

  /**
   * Reverses the time-line contribution of a paid purchase when the purchase
   * is voided. The caller has already locked the full chain (user, account,
   * purchase, membership, segment, grant, original grant entry) and verified
   * voidability; this method performs only the pure membership-state restore
   * based on the segment kind recorded at fulfilment. Segments are immutable:
   * this never deletes or updates a segment row.
   */
  async restoreVoidedPurchase(
    manager: EntityManager,
    input: {
      account: MemberAccount;
      purchase: MembershipPurchaseOrder;
      segment: MembershipEntitlementSegment;
      targetMembership: UserMembership;
      previousMembership: UserMembership | null;
      now: Date;
    },
  ): Promise<MembershipRestoreResult> {
    const { account, segment, targetMembership, previousMembership, now } =
      input;

    if (segment.kind === MembershipEntitlementSegmentKind.RENEWAL) {
      return this.restoreRenewal(
        manager,
        account,
        segment,
        targetMembership,
        now,
      );
    }
    if (segment.kind === MembershipEntitlementSegmentKind.UPGRADE) {
      return this.restoreUpgrade(
        manager,
        account,
        segment,
        targetMembership,
        previousMembership,
        now,
      );
    }
    return this.restoreInitial(
      manager,
      account,
      targetMembership,
      previousMembership,
      now,
    );
  }

  private async restoreRenewal(
    manager: EntityManager,
    account: MemberAccount,
    segment: MembershipEntitlementSegment,
    targetMembership: UserMembership,
    now: Date,
  ): Promise<MembershipRestoreResult> {
    const memberships = manager.getRepository(UserMembership);
    const restoredEndsAt = segment.startsAt;
    const membership = await memberships.save({
      ...targetMembership,
      endsAt: restoredEndsAt,
      status:
        restoredEndsAt.getTime() > now.getTime()
          ? MembershipStatus.ACTIVE
          : MembershipStatus.EXPIRED,
    });
    const expired = membership.status !== MembershipStatus.ACTIVE;
    const savedAccount = await manager.getRepository(MemberAccount).save({
      ...account,
      activeMembershipId: expired ? null : membership.id,
    });
    return {
      account: savedAccount,
      membership,
      voidedMembership: null,
    };
  }

  private async restoreUpgrade(
    manager: EntityManager,
    account: MemberAccount,
    segment: MembershipEntitlementSegment,
    targetMembership: UserMembership,
    previousMembership: UserMembership | null,
    now: Date,
  ): Promise<MembershipRestoreResult> {
    const memberships = manager.getRepository(UserMembership);
    const voidedMembership = await memberships.save({
      ...targetMembership,
      status: MembershipStatus.VOIDED,
    });
    const previousEndsAt =
      segment.previousMembershipEndsAt ?? previousMembership?.endsAt ?? null;
    const previousStillValid =
      previousMembership &&
      previousEndsAt !== null &&
      previousEndsAt.getTime() > now.getTime();
    if (previousMembership) {
      await memberships.save({
        ...previousMembership,
        endsAt: previousEndsAt ?? previousMembership.endsAt,
        status: previousStillValid
          ? MembershipStatus.ACTIVE
          : MembershipStatus.EXPIRED,
      });
    }
    const savedAccount = await manager.getRepository(MemberAccount).save({
      ...account,
      activeMembershipId: previousStillValid ? previousMembership.id : null,
    });
    return {
      account: savedAccount,
      membership: previousStillValid ? previousMembership : voidedMembership,
      voidedMembership,
    };
  }

  private async restoreInitial(
    manager: EntityManager,
    account: MemberAccount,
    targetMembership: UserMembership,
    previousMembership: UserMembership | null,
    now: Date,
  ): Promise<MembershipRestoreResult> {
    const memberships = manager.getRepository(UserMembership);
    const voidedMembership = await memberships.save({
      ...targetMembership,
      status: MembershipStatus.VOIDED,
    });
    const previousStillValid = Boolean(
      previousMembership &&
      previousMembership.endsAt.getTime() > now.getTime() &&
      previousMembership.status !== MembershipStatus.VOIDED,
    );
    if (previousMembership && previousStillValid) {
      await memberships.save({
        ...previousMembership,
        status: MembershipStatus.ACTIVE,
      });
    }
    const savedAccount = await manager.getRepository(MemberAccount).save({
      ...account,
      activeMembershipId: previousStillValid ? previousMembership!.id : null,
    });
    return {
      account: savedAccount,
      membership: previousStillValid ? previousMembership! : voidedMembership,
      voidedMembership,
    };
  }

  private async createInitial(
    manager: EntityManager,
    account: MemberAccount,
    purchase: MembershipPurchaseOrder,
    now: Date,
    previousMembership: UserMembership | null,
  ): Promise<MembershipApplicationResult> {
    const memberships = manager.getRepository(UserMembership);
    const segments = manager.getRepository(MembershipEntitlementSegment);
    const endsAt = this.addUtcDays(now, purchase.validDays);
    const membership = await memberships.save(
      memberships.create({
        userId: purchase.userId,
        purchaseOrderId: purchase.id,
        membershipLevelId: purchase.membershipLevelId,
        levelCode: purchase.levelCode,
        levelName: purchase.levelName,
        levelRank: purchase.levelRank,
        discountBasisPoints: purchase.discountBasisPoints,
        benefits: purchase.benefits,
        theme: purchase.theme,
        badgeText: purchase.badgeText,
        startsAt: now,
        endsAt,
        previousMembershipId: previousMembership?.id ?? null,
        status: MembershipStatus.ACTIVE,
      }),
    );
    const segment = await segments.save(
      segments.create({
        membershipId: membership.id,
        purchaseOrderId: purchase.id,
        kind: MembershipEntitlementSegmentKind.INITIAL,
        startsAt: now,
        endsAt,
        previousMembershipId: null,
        previousMembershipEndsAt: null,
      }),
    );
    const savedAccount = await manager.getRepository(MemberAccount).save({
      ...account,
      activeMembershipId: membership.id,
    });
    return {
      kind: MembershipEntitlementSegmentKind.INITIAL,
      account: savedAccount,
      membership,
      segment,
      replacedMembership: previousMembership,
    };
  }

  private async renew(
    manager: EntityManager,
    account: MemberAccount,
    purchase: MembershipPurchaseOrder,
    current: UserMembership,
  ): Promise<MembershipApplicationResult> {
    const segments = manager.getRepository(MembershipEntitlementSegment);
    const tail = await segments.findOne({
      where: { membershipId: current.id },
      order: { endsAt: 'DESC', id: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });
    if (!tail || tail.endsAt.getTime() !== current.endsAt.getTime()) {
      throw new ConflictException('会员有效期贡献链不连续');
    }
    const endsAt = this.addUtcDays(current.endsAt, purchase.validDays);
    const membership = await manager.getRepository(UserMembership).save({
      ...current,
      endsAt,
    });
    const segment = await segments.save(
      segments.create({
        membershipId: current.id,
        purchaseOrderId: purchase.id,
        kind: MembershipEntitlementSegmentKind.RENEWAL,
        startsAt: current.endsAt,
        endsAt,
        previousMembershipId: null,
        previousMembershipEndsAt: null,
      }),
    );
    return {
      kind: MembershipEntitlementSegmentKind.RENEWAL,
      account,
      membership,
      segment,
      replacedMembership: null,
    };
  }

  private async upgrade(
    manager: EntityManager,
    account: MemberAccount,
    purchase: MembershipPurchaseOrder,
    current: UserMembership,
    now: Date,
  ): Promise<MembershipApplicationResult> {
    const memberships = manager.getRepository(UserMembership);
    const segments = manager.getRepository(MembershipEntitlementSegment);
    const originalEndsAt = current.endsAt;
    const replacedMembership = await memberships.save({
      ...current,
      endsAt: now,
      status: MembershipStatus.REPLACED,
    });
    const endsAt = this.addUtcDays(now, purchase.validDays);
    const membership = await memberships.save(
      memberships.create({
        userId: purchase.userId,
        purchaseOrderId: purchase.id,
        membershipLevelId: purchase.membershipLevelId,
        levelCode: purchase.levelCode,
        levelName: purchase.levelName,
        levelRank: purchase.levelRank,
        discountBasisPoints: purchase.discountBasisPoints,
        benefits: purchase.benefits,
        theme: purchase.theme,
        badgeText: purchase.badgeText,
        startsAt: now,
        endsAt,
        previousMembershipId: current.id,
        status: MembershipStatus.ACTIVE,
      }),
    );
    const segment = await segments.save(
      segments.create({
        membershipId: membership.id,
        purchaseOrderId: purchase.id,
        kind: MembershipEntitlementSegmentKind.UPGRADE,
        startsAt: now,
        endsAt,
        previousMembershipId: current.id,
        previousMembershipEndsAt: originalEndsAt,
      }),
    );
    const savedAccount = await manager.getRepository(MemberAccount).save({
      ...account,
      activeMembershipId: membership.id,
    });
    return {
      kind: MembershipEntitlementSegmentKind.UPGRADE,
      account: savedAccount,
      membership,
      segment,
      replacedMembership,
    };
  }

  private isActive(membership: UserMembership | null, now: Date): boolean {
    return Boolean(
      membership &&
      membership.status === MembershipStatus.ACTIVE &&
      membership.startsAt <= now &&
      membership.endsAt > now,
    );
  }

  private addUtcDays(startsAt: Date, validDays: number): Date {
    if (!Number.isSafeInteger(validDays) || validDays <= 0) {
      throw new ConflictException('会员有效期天数无效');
    }
    const start = startsAt.getTime();
    const duration = validDays * DAY_MILLISECONDS;
    const endsAt = start + duration;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(duration) ||
      !Number.isSafeInteger(endsAt)
    ) {
      throw new ConflictException('会员有效期超出日期范围');
    }
    const result = new Date(endsAt);
    if (Number.isNaN(result.getTime()))
      throw new ConflictException('会员有效期超出日期范围');
    return result;
  }

  private downgradeNotAllowed(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.MEMBERSHIP_DOWNGRADE_NOT_ALLOWED,
      message: '当前会员有效期内不可购买更低等级',
    });
  }
}
