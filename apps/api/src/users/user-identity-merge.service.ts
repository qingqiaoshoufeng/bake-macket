import { createHash } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { AdminRole, ApiErrorCode } from '@bake-mall/contracts';

import { AuditService } from '../audit/audit.service.js';
import { Address } from '../database/entities/address.entity.js';
import { AdminUser } from '../database/entities/admin-user.entity.js';
import { CartItem } from '../database/entities/cart-item.entity.js';
import { MemberAccount } from '../database/entities/member-account.entity.js';
import { MemberCreditAllocation } from '../database/entities/member-credit-allocation.entity.js';
import { MemberCreditEntry } from '../database/entities/member-credit-entry.entity.js';
import { MemberCreditGrant } from '../database/entities/member-credit-grant.entity.js';
import { MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';
import { Order } from '../database/entities/order.entity.js';
import { UserMembership } from '../database/entities/user-membership.entity.js';
import { User } from '../database/entities/user.entity.js';
import {
  UserIdentityService,
  normalizePhone,
} from './user-identity.service.js';

export type UserIdentityConflictCategory =
  | 'FINANCIAL_FACTS'
  | 'WECHAT_IDENTITY'
  | 'ADMIN_UNIQUENESS'
  | 'CART_QUANTITY'
  | 'PHONE_OWNERSHIP';

const errorCodeByCategory = {
  FINANCIAL_FACTS: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
  WECHAT_IDENTITY: ApiErrorCode.WECHAT_IDENTITY_CONFLICT,
  ADMIN_UNIQUENESS: ApiErrorCode.ADMIN_USER_CONFLICT,
  CART_QUANTITY: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
  PHONE_OWNERSHIP: ApiErrorCode.USER_MERGE_REQUIRES_MANUAL_REVIEW,
} as const;

export class UserIdentityRuleConflict extends ConflictException {
  constructor(
    readonly category: UserIdentityConflictCategory,
    readonly counts: Record<string, number>,
  ) {
    super({
      code: errorCodeByCategory[category],
      message: 'User identity merge requires manual review.',
      category,
      counts,
    });
  }
}

export const userIdentityConflict = (
  category: UserIdentityConflictCategory,
  counts: Record<string, number>,
): UserIdentityRuleConflict => new UserIdentityRuleConflict(category, counts);

const scalarIsOne = (rows: unknown, key: string): boolean =>
  Array.isArray(rows) &&
  typeof rows[0] === 'object' &&
  rows[0] !== null &&
  key in rows[0] &&
  Number((rows[0] as Record<string, unknown>)[key]) === 1;

type WechatIdentity = Pick<User, 'wechatOpenid' | 'wechatUnionid'>;
type CustomerProfile = Pick<User, 'nickname' | 'avatarObjectKey' | 'avatarUrl'>;

const managedAvatar = (
  profile: Pick<CustomerProfile, 'avatarObjectKey' | 'avatarUrl'>,
): Pick<CustomerProfile, 'avatarObjectKey' | 'avatarUrl'> | null => {
  const avatarObjectKey = profile.avatarObjectKey ?? null;
  const avatarUrl = profile.avatarUrl ?? null;
  const hasKey = avatarObjectKey !== null;
  const hasUrl = avatarUrl !== null;
  if (hasKey && !hasUrl) throw new Error('Managed avatar pair is incomplete');
  return hasKey && hasUrl ? { avatarObjectKey, avatarUrl } : null;
};

const normalizedProfileNickname = (nickname: string | null): string | null =>
  nickname?.trim() || null;

export const mergeCustomerProfile = (
  canonical: CustomerProfile,
  source: CustomerProfile,
): CustomerProfile => {
  const canonicalAvatar = managedAvatar(canonical);
  const sourceAvatar = managedAvatar(source);
  const avatar = canonicalAvatar ??
    sourceAvatar ?? {
      avatarObjectKey: null,
      avatarUrl: null,
    };
  return {
    nickname:
      normalizedProfileNickname(canonical.nickname) ??
      normalizedProfileNickname(source.nickname),
    ...avatar,
  };
};

export const assertWechatIdentityCompatible = (
  canonical: WechatIdentity,
  source: WechatIdentity,
): void => {
  for (const key of ['wechatOpenid', 'wechatUnionid'] as const) {
    if (canonical[key] && source[key] && canonical[key] !== source[key]) {
      throw userIdentityConflict('WECHAT_IDENTITY', { conflictingFields: 1 });
    }
  }
};

type AddressDefaultRow = Pick<Address, 'id' | 'userId' | 'isDefault'>;

type AddressDefaultPlan = Array<Pick<Address, 'id' | 'isDefault'>>;

const compareIds = (left: string, right: string): number =>
  left.localeCompare(right, 'en', { numeric: true });

export const planMergedAddressDefaults = (
  rows: AddressDefaultRow[],
  canonicalUserId: string,
  sourceUserId: string,
): AddressDefaultPlan => {
  const canonicalDefault = rows
    .filter(({ userId, isDefault }) => userId === canonicalUserId && isDefault)
    .sort((left, right) => compareIds(left.id, right.id))[0];
  const sourceDefault = rows
    .filter(({ userId, isDefault }) => userId === sourceUserId && isDefault)
    .sort((left, right) => compareIds(left.id, right.id))[0];
  const retainedDefaultId = canonicalDefault?.id ?? sourceDefault?.id;
  return rows.map(({ id }) => ({ id, isDefault: id === retainedDefaultId }));
};

type CartRow = Pick<CartItem, 'id' | 'userId' | 'skuId' | 'quantity'>;

type CartMergePlan = {
  updates: Array<Pick<CartItem, 'id' | 'userId' | 'quantity'>>;
  deleteIds: string[];
};

const assertCartQuantity = (
  quantity: number,
  conflictingRows: number,
): void => {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
    throw userIdentityConflict('CART_QUANTITY', { conflictingRows });
  }
};

export const mergeCartRows = (
  canonicalRows: CartRow[],
  sourceRows: CartRow[],
  canonicalUserId: string,
): CartMergePlan => {
  for (const row of canonicalRows) assertCartQuantity(row.quantity, 1);
  const bySku = new Map(canonicalRows.map((row) => [row.skuId, row]));
  const updates: CartMergePlan['updates'] = [];
  const deleteIds: string[] = [];
  for (const source of [...sourceRows].sort((left, right) =>
    left.skuId.localeCompare(right.skuId, 'en', { numeric: true }),
  )) {
    assertCartQuantity(source.quantity, 1);
    const canonical = bySku.get(source.skuId);
    if (!canonical) {
      updates.push({
        id: source.id,
        userId: canonicalUserId,
        quantity: source.quantity,
      });
      continue;
    }
    const quantity = canonical.quantity + source.quantity;
    assertCartQuantity(quantity, 2);
    updates.push({ id: canonical.id, userId: canonicalUserId, quantity });
    deleteIds.push(source.id);
  }
  return { updates, deleteIds };
};

export type MergeVerifiedPhoneInput = {
  authenticatedUserId: string;
  normalizedPhone: string;
};

const PHONE_LOCK_PREFIX = 'phone:';
const PHONE_LOCK_TIMEOUT_SECONDS = 5;

export const buildPhoneLockName = (normalizedPhone: string): string =>
  `${PHONE_LOCK_PREFIX}${createHash('sha256')
    .update(normalizedPhone, 'utf8')
    .digest('hex')
    .slice(0, 64 - PHONE_LOCK_PREFIX.length)}`;

type PhoneLockContext = {
  manager: EntityManager;
  mergeVerifiedPhone: (
    input: MergeVerifiedPhoneInput,
  ) => Promise<MergeVerifiedPhoneResult>;
};

export type MergeVerifiedPhoneResult = {
  userId: string;
  user: User;
  migrated: { addresses: number; cartItems: number };
  operatorChanged: boolean;
};

export class UserIdentityMergeRejectedError extends Error {
  constructor(
    readonly conflict: ConflictException,
    readonly canonicalId: string,
    readonly sourceId: string,
    readonly category: UserIdentityConflictCategory,
    readonly counts: Record<string, number>,
  ) {
    super('Audited identity merge conflict');
  }
}

@Injectable()
export class UserIdentityMergeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly identities: UserIdentityService,
    private readonly audit: AuditService,
  ) {}

  async mergeVerifiedPhone(
    input: MergeVerifiedPhoneInput,
  ): Promise<MergeVerifiedPhoneResult> {
    try {
      return await this.withPhoneLock(
        input.normalizedPhone,
        ({ mergeVerifiedPhone }) => mergeVerifiedPhone(input),
      );
    } catch (error) {
      if (error instanceof UserIdentityMergeRejectedError) {
        await this.recordRejectedConflict(error);
        throw error.conflict;
      }
      throw error;
    }
  }

  async mergeVerifiedPhoneInTransaction(
    input: MergeVerifiedPhoneInput,
    manager: EntityManager,
  ): Promise<MergeVerifiedPhoneResult> {
    return this.mergeWithUniqueViolationMapping(input, manager);
  }

  async withPhoneLock<T>(
    normalizedPhone: string,
    operation: (context: PhoneLockContext) => Promise<T>,
  ): Promise<T> {
    const phone = normalizePhone(normalizedPhone);
    const lockName = buildPhoneLockName(phone);
    const runner = this.dataSource.createQueryRunner();
    let lockHeld = false;
    try {
      await runner.connect();
      const lockResult = await runner.query(
        'SELECT GET_LOCK(?, ?) AS `lock_acquired`',
        [lockName, PHONE_LOCK_TIMEOUT_SECONDS],
      );
      lockHeld = scalarIsOne(lockResult, 'lock_acquired');
      if (!lockHeld) {
        throw new ServiceUnavailableException(
          'Phone identity update is temporarily unavailable.',
        );
      }
      await runner.startTransaction();
      try {
        const result = await operation({
          manager: runner.manager,
          mergeVerifiedPhone: (input) =>
            this.mergeVerifiedPhoneInTransaction(input, runner.manager),
        });
        await runner.commitTransaction();
        return result;
      } catch (error) {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        throw error;
      }
    } finally {
      try {
        if (lockHeld) {
          await runner.query('SELECT RELEASE_LOCK(?) AS `lock_released`', [
            lockName,
          ]);
        }
      } finally {
        await runner.release();
      }
    }
  }

  async recordRejectedConflict(
    error: UserIdentityMergeRejectedError,
  ): Promise<void> {
    try {
      await this.audit.record({
        actor: { type: 'USER', userId: error.sourceId },
        targetEntity: 'users',
        targetId: error.canonicalId,
        action: 'SECURITY_IDENTITY_MERGE_REJECTED',
        changeSummary: {
          canonicalUserId: error.canonicalId,
          sourceUserId: error.sourceId,
          category: error.category,
          counts: error.counts,
        },
      });
    } catch {
      // Preserve the deterministic business conflict if independent audit fails.
    }
  }

  private async mergeWithUniqueViolationMapping(
    input: MergeVerifiedPhoneInput,
    manager: EntityManager,
  ): Promise<MergeVerifiedPhoneResult> {
    try {
      return await this.mergeInTransaction(input, manager);
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const phone = normalizePhone(input.normalizedPhone);
      const owner = await manager.getRepository(User).findOne({
        where: { phone },
        select: {
          id: true,
          phone: true,
          phoneVerified: true,
          isActive: true,
          mergedIntoUserId: true,
        },
      });
      if (!owner || owner.id === input.authenticatedUserId) throw error;
      throw new UserIdentityMergeRejectedError(
        userIdentityConflict('PHONE_OWNERSHIP', { competingOwners: 1 }),
        owner.id,
        input.authenticatedUserId,
        'PHONE_OWNERSHIP',
        { competingOwners: 1 },
      );
    }
  }

  private async mergeInTransaction(
    input: MergeVerifiedPhoneInput,
    manager: EntityManager,
  ): Promise<MergeVerifiedPhoneResult> {
    const phone = normalizePhone(input.normalizedPhone);
    const candidates = await manager.getRepository(User).find({
      where: [{ id: input.authenticatedUserId }, { phone }],
      select: {
        id: true,
        phone: true,
        phoneVerified: true,
        isActive: true,
        mergedIntoUserId: true,
      },
    });
    if (!candidates.some(({ id }) => id === input.authenticatedUserId)) {
      throw new NotFoundException('User no longer exists');
    }
    const phoneOwners = candidates.filter(
      ({ id, phone: candidatePhone }) =>
        id !== input.authenticatedUserId && candidatePhone === phone,
    );
    if (phoneOwners.length > 1) {
      throw new UserIdentityMergeRejectedError(
        userIdentityConflict('PHONE_OWNERSHIP', {
          competingOwners: phoneOwners.length,
        }),
        phoneOwners[0]?.id ?? input.authenticatedUserId,
        input.authenticatedUserId,
        'PHONE_OWNERSHIP',
        { competingOwners: phoneOwners.length },
      );
    }
    const phoneOwnerId = phoneOwners[0]?.id;
    const ids = [
      input.authenticatedUserId,
      ...(phoneOwnerId ? [phoneOwnerId] : []),
    ].sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
    const users = await manager
      .getRepository(User)
      .createQueryBuilder('user')
      .setLock('pessimistic_write')
      .where('user.id IN (:...ids)', { ids })
      .orderBy('user.id', 'ASC')
      .getMany();
    const source = users.find(({ id }) => id === input.authenticatedUserId);
    if (!source || !source.isActive || source.mergedIntoUserId) {
      throw new NotFoundException('User is inactive or merged');
    }
    const phoneOwner = phoneOwnerId
      ? users.find(({ id }) => id === phoneOwnerId)
      : undefined;
    const canonical = phoneOwner ?? source;

    const reject = (
      category: UserIdentityConflictCategory,
      counts: Record<string, number>,
    ): never => {
      throw new UserIdentityMergeRejectedError(
        userIdentityConflict(category, counts),
        canonical.id,
        source.id,
        category,
        counts,
      );
    };

    if (
      phoneOwner &&
      (phoneOwner.phone !== phone ||
        phoneOwner.phoneVerified ||
        !phoneOwner.isActive ||
        phoneOwner.mergedIntoUserId !== null)
    ) {
      reject('PHONE_OWNERSHIP', { verifiedOrInactiveOwners: 1 });
    }
    if (!phoneOwner && source.phone && source.phone !== phone) {
      // The unique index remains the final guard against a concurrent phone owner.
    }

    const operators = await manager
      .getRepository(AdminUser)
      .createQueryBuilder('admin')
      .setLock('pessimistic_write')
      .where('admin.linkedUserId IN (:...ids)', { ids })
      .orderBy('admin.linkedUserId', 'ASC')
      .addOrderBy('admin.id', 'ASC')
      .getMany();
    if (operators.some(({ role }) => role !== AdminRole.OPERATOR)) {
      reject('ADMIN_UNIQUENESS', { invalidLinkedAdmins: 1 });
    }
    const canonicalOperators = operators.filter(
      ({ linkedUserId }) => linkedUserId === canonical.id,
    );
    const sourceOperators = operators.filter(
      ({ linkedUserId }) => linkedUserId === source.id,
    );

    if (source.id === canonical.id) {
      const operatorChanged = false;
      await this.identities.applyLockedPhoneIdentity(
        canonical,
        { phone, phoneVerified: true, forceTokenVersionIncrement: true },
        manager,
      );
      await this.audit.record(
        {
          actor: { type: 'USER', userId: canonical.id },
          targetEntity: 'users',
          targetId: canonical.id,
          action: 'USER_PHONE_VERIFIED',
          changeSummary: {
            canonicalUserId: canonical.id,
            sourceUserId: source.id,
            sameRecord: true,
            operatorChanged,
          },
        },
        manager,
      );
      return {
        userId: canonical.id,
        user: canonical,
        migrated: { addresses: 0, cartItems: 0 },
        operatorChanged,
      };
    }

    if (canonicalOperators.length > 1 || sourceOperators.length > 0) {
      reject('ADMIN_UNIQUENESS', {
        canonicalOperators: canonicalOperators.length,
        sourceOperators: sourceOperators.length,
      });
    }
    try {
      assertWechatIdentityCompatible(canonical, source);
    } catch (error) {
      if (error instanceof UserIdentityRuleConflict) {
        reject('WECHAT_IDENTITY', { conflictingFields: 1 });
      }
      throw error;
    }

    const addresses = await manager
      .getRepository(Address)
      .createQueryBuilder('address')
      .setLock('pessimistic_write')
      .where('address.userId IN (:...ids)', { ids })
      .orderBy('address.id', 'ASC')
      .getMany();
    const carts = await manager
      .getRepository(CartItem)
      .createQueryBuilder('cart')
      .setLock('pessimistic_write')
      .where('cart.userId IN (:...ids)', { ids })
      .orderBy('cart.skuId', 'ASC')
      .addOrderBy('cart.id', 'ASC')
      .getMany();

    const financialCounts = await this.financialFactCounts(source.id, manager);
    if (Object.values(financialCounts).some((count) => count > 0)) {
      reject('FINANCIAL_FACTS', financialCounts);
    }

    let cartPlan: CartMergePlan;
    try {
      cartPlan = mergeCartRows(
        carts.filter(({ userId }) => userId === canonical.id),
        carts.filter(({ userId }) => userId === source.id),
        canonical.id,
      );
    } catch (error) {
      if (error instanceof UserIdentityRuleConflict) {
        reject('CART_QUANTITY', { cartItems: carts.length });
      }
      throw error;
    }

    const addressDefaultPlan = planMergedAddressDefaults(
      addresses,
      canonical.id,
      source.id,
    );
    const defaultByAddressId = new Map(
      addressDefaultPlan.map(({ id, isDefault }) => [id, isDefault]),
    );
    const sourceAddresses = addresses.filter(
      ({ userId }) => userId === source.id,
    );
    for (const address of addresses) {
      address.isDefault = defaultByAddressId.get(address.id) ?? false;
    }
    for (const address of sourceAddresses) address.userId = canonical.id;
    if (addresses.length > 0) {
      await manager.getRepository(Address).save(addresses);
    }
    if (cartPlan.deleteIds.length > 0) {
      await manager.getRepository(CartItem).delete(cartPlan.deleteIds);
    }
    for (const update of cartPlan.updates) {
      await manager.getRepository(CartItem).update(update.id, {
        userId: update.userId,
        quantity: update.quantity,
      });
    }

    const operatorChanged = false;

    const sourceWechatIdentity = {
      openid: source.wechatOpenid,
      unionid: source.wechatUnionid,
    };
    const mergedProfile = mergeCustomerProfile(canonical, source);
    canonical.nickname = mergedProfile.nickname;
    canonical.avatarObjectKey = mergedProfile.avatarObjectKey;
    canonical.avatarUrl = mergedProfile.avatarUrl;
    source.nickname = null;
    source.avatarObjectKey = null;
    source.avatarUrl = null;
    source.isActive = false;
    source.mergedIntoUserId = canonical.id;
    source.wechatOpenid = null;
    source.wechatUnionid = null;
    await this.identities.applyLockedPhoneIdentity(
      source,
      {
        phone: null,
        phoneVerified: false,
        forceTokenVersionIncrement: true,
      },
      manager,
    );

    canonical.wechatOpenid ??= sourceWechatIdentity.openid;
    canonical.wechatUnionid ??= sourceWechatIdentity.unionid;
    canonical.isActive = true;
    canonical.mergedIntoUserId = null;
    await this.identities.applyLockedPhoneIdentity(
      canonical,
      { phone, phoneVerified: true, forceTokenVersionIncrement: true },
      manager,
    );

    const result = {
      userId: canonical.id,
      user: canonical,
      migrated: {
        addresses: sourceAddresses.length,
        cartItems: cartPlan.updates.length,
      },
      operatorChanged,
    };
    await this.audit.record(
      {
        actor: { type: 'USER', userId: canonical.id },
        targetEntity: 'users',
        targetId: canonical.id,
        action: 'USER_IDENTITY_MERGED',
        changeSummary: {
          canonicalUserId: canonical.id,
          sourceUserId: source.id,
          migrated: result.migrated,
          operatorChanged,
        },
      },
      manager,
    );
    return result;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ER_DUP_ENTRY'
    );
  }

  private async financialFactCounts(
    sourceUserId: string,
    manager: EntityManager,
  ): Promise<Record<string, number>> {
    const orders = await manager
      .getRepository(Order)
      .count({ where: { userId: sourceUserId } });
    const membershipPurchases = await manager
      .getRepository(MembershipPurchaseOrder)
      .count({ where: { userId: sourceUserId } });
    const memberships = await manager
      .getRepository(UserMembership)
      .count({ where: { userId: sourceUserId } });
    const accounts = await manager.getRepository(MemberAccount).find({
      where: { userId: sourceUserId },
      select: { id: true },
    });
    const accountIds = accounts.map(({ id }) => id);
    if (accountIds.length === 0) {
      return {
        orders,
        membershipPurchases,
        memberships,
        memberAccounts: 0,
        creditEntries: 0,
        creditGrants: 0,
        creditAllocations: 0,
      };
    }
    const entries = await manager.getRepository(MemberCreditEntry).find({
      where: { accountId: In(accountIds) },
      select: { id: true },
    });
    const grants = await manager.getRepository(MemberCreditGrant).find({
      where: { accountId: In(accountIds) },
      select: { id: true },
    });
    const entryIds = entries.map(({ id }) => id);
    const grantIds = grants.map(({ id }) => id);
    const allocationWhere = [
      ...(entryIds.length > 0 ? [{ creditEntryId: In(entryIds) }] : []),
      ...(grantIds.length > 0 ? [{ grantId: In(grantIds) }] : []),
    ];
    const creditAllocations =
      allocationWhere.length === 0
        ? 0
        : await manager
            .getRepository(MemberCreditAllocation)
            .count({ where: allocationWhere });
    return {
      orders,
      membershipPurchases,
      memberships,
      memberAccounts: accounts.length,
      creditEntries: entries.length,
      creditGrants: grants.length,
      creditAllocations,
    };
  }
}
