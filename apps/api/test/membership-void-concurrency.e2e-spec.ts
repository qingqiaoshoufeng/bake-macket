import 'reflect-metadata';

import {
  ApiErrorCode,
  MemberCreditEntryType,
  MemberCreditGrantStatus,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipStatus,
  MembershipTheme,
} from '@bake-mall/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { AuditLog } from '../src/database/entities/audit-log.entity.js';
import * as entities from '../src/database/entities/index.js';
import { IdempotencyRecord } from '../src/database/entities/idempotency-record.entity.js';
import { MemberAccount } from '../src/database/entities/member-account.entity.js';
import { MemberCreditAllocation } from '../src/database/entities/member-credit-allocation.entity.js';
import { MemberCreditEntry } from '../src/database/entities/member-credit-entry.entity.js';
import { MemberCreditGrant } from '../src/database/entities/member-credit-grant.entity.js';
import { MembershipEntitlementSegment } from '../src/database/entities/membership-entitlement-segment.entity.js';
import { MembershipLevel } from '../src/database/entities/membership-level.entity.js';
import { MembershipPurchaseOrder } from '../src/database/entities/membership-purchase-order.entity.js';
import { Order } from '../src/database/entities/order.entity.js';
import { UserMembership } from '../src/database/entities/user-membership.entity.js';
import { User } from '../src/database/entities/user.entity.js';
import { DATABASE_MIGRATIONS } from '../src/database/migrations/index.js';
import { MembershipCreditService } from '../src/membership/membership-credit.service.js';
import { MembershipEntitlementService } from '../src/membership/membership-entitlement.service.js';
import { MembershipPurchaseService } from '../src/membership/membership-purchase.service.js';
import {
  createDockerRootSqlExecutor,
  mysqlTestDatabaseState,
  provisionMysqlTestDatabase,
} from './helpers/mysql-test-database.js';

const DATABASE_NAME = `bake_mall_membership_void_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };
const DEBIT_AMOUNT_CENTS = 10_000;
const CLOCK = new Date('2026-07-21T08:00:00.000Z');

type PaidPurchaseFixture = {
  user: User;
  purchase: MembershipPurchaseOrder;
  account: MemberAccount;
  membership: UserMembership;
  segment: MembershipEntitlementSegment;
  grant: MemberCreditGrant;
  grantEntry: MemberCreditEntry;
};

type VoidSnapshot = {
  purchase: MembershipPurchaseOrder;
  account: MemberAccount;
  memberships: UserMembership[];
  grant: MemberCreditGrant;
  entries: MemberCreditEntry[];
  segment: MembershipEntitlementSegment;
};

function domainErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  return typeof response === 'object' && response !== null && 'code' in response
    ? (response as { code?: unknown }).code
    : undefined;
}

function segmentSnapshot(segment: MembershipEntitlementSegment) {
  return {
    id: segment.id,
    kind: segment.kind,
    startsAt: segment.startsAt,
    endsAt: segment.endsAt,
    membershipId: segment.membershipId,
    purchaseOrderId: segment.purchaseOrderId,
    previousMembershipId: segment.previousMembershipId,
    previousMembershipEndsAt: segment.previousMembershipEndsAt,
    createdAt: segment.createdAt,
  };
}

function databaseErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('code' in error) return (error as { code?: unknown }).code;
  if ('driverError' in error) {
    return databaseErrorCode((error as { driverError?: unknown }).driverError);
  }
  return undefined;
}

function expectDomainRejection(
  outcome: PromiseSettledResult<unknown>,
  expectedCode: ApiErrorCode,
): void {
  expect(outcome.status).toBe('rejected');
  if (outcome.status !== 'rejected') return;
  expect(domainErrorCode(outcome.reason)).toBe(expectedCode);
  expect(databaseErrorCode(outcome.reason)).not.toBe('ER_LOCK_DEADLOCK');
  expect(databaseErrorCode(outcome.reason)).not.toBe('ER_LOCK_WAIT_TIMEOUT');
  expect(databaseErrorCode(outcome.reason)).not.toBe('ER_DUP_ENTRY');
}

describe.sequential('membership void concurrency (MySQL)', () => {
  const rootSql = createDockerRootSqlExecutor();
  const credit = new MembershipCreditService();
  let cleanupDatabase: (() => void) | undefined;
  let database: DataSource | undefined;
  let service: MembershipPurchaseService;
  let admin: AdminUser;
  let lowLevel: MembershipLevel;
  let highLevel: MembershipLevel;
  let clock = CLOCK;

  const requireDatabase = (): DataSource => {
    if (!database) throw new Error('Temporary data source is unavailable');
    return database;
  };

  const createUser = async (phone: string): Promise<User> => {
    const source = requireDatabase();
    return source.getRepository(User).save(
      source.getRepository(User).create({
        phone,
        phoneVerified: true,
      }),
    );
  };

  const saveLevel = async (input: {
    code: string;
    name: string;
    rank: number;
    grantCreditCents: number;
    validDays: number;
    discountBasisPoints: number;
    theme: MembershipTheme;
  }): Promise<MembershipLevel> => {
    const source = requireDatabase();
    return source.getRepository(MembershipLevel).save(
      source.getRepository(MembershipLevel).create({
        ...input,
        subtitle: null,
        description: null,
        priceCents: 50_000,
        benefits: [{ title: `${input.name}权益`, sortOrder: 10 }],
        badgeText: input.code,
        sortOrder: input.rank,
        isActive: true,
      }),
    );
  };

  const createAndPay = async (
    user: User,
    level: MembershipLevel,
  ): Promise<PaidPurchaseFixture> => {
    const source = requireDatabase();
    const created = await service.createPurchase(
      user.id,
      `create-${randomUUID()}`,
      { levelId: level.id },
    );
    await service.simulatePayment(
      user.id,
      created.id,
      `payment-${randomUUID()}`,
    );
    const purchase = await source
      .getRepository(MembershipPurchaseOrder)
      .findOneByOrFail({ id: created.id });
    const account = await source
      .getRepository(MemberAccount)
      .findOneByOrFail({ userId: user.id });
    const segment = await source
      .getRepository(MembershipEntitlementSegment)
      .findOneByOrFail({ purchaseOrderId: purchase.id });
    const [membership, grant, grantEntry] = await Promise.all([
      source
        .getRepository(UserMembership)
        .findOneByOrFail({ id: segment.membershipId }),
      source
        .getRepository(MemberCreditGrant)
        .findOneByOrFail({ purchaseOrderId: purchase.id }),
      source.getRepository(MemberCreditEntry).findOneByOrFail({
        operationKey: `membership-purchase-grant:${purchase.id}`,
      }),
    ]);
    return {
      user,
      purchase,
      account,
      membership,
      segment,
      grant,
      grantEntry,
    };
  };

  const debitInTransaction = async (userId: string, operationKey: string) =>
    requireDatabase().transaction(async (manager: EntityManager) => {
      const lockedUser = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedUser) throw new Error('Debit fixture user is missing');
      const account = await credit.lockOrCreateAccount(manager, userId);
      return credit.debitFifo(manager, account, {
        amountCents: DEBIT_AMOUNT_CENTS,
        referenceType: 'TEST_ORDER',
        referenceId: `order-${operationKey}`,
        operationKey,
      });
    });

  const expectCreditConservation = async (userId: string): Promise<void> => {
    const source = requireDatabase();
    const account = await source
      .getRepository(MemberAccount)
      .findOneByOrFail({ userId });
    const [grants, entries] = await Promise.all([
      source.getRepository(MemberCreditGrant).find({
        where: { accountId: account.id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      source.getRepository(MemberCreditEntry).find({
        where: { accountId: account.id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
    ]);
    const expectedAvailable = grants
      .filter(({ status }) => status !== MemberCreditGrantStatus.REVERSED)
      .reduce((total, { remainingCents }) => total + remainingCents, 0);
    expect(account.availableCreditCents).toBe(expectedAvailable);
    expect(account.availableCreditCents).toBeGreaterThanOrEqual(0);
    expect(grants.every(({ remainingCents }) => remainingCents >= 0)).toBe(
      true,
    );
    expect(new Set(entries.map(({ operationKey }) => operationKey)).size).toBe(
      entries.length,
    );
  };

  const snapshotVoidState = async (
    fixture: PaidPurchaseFixture,
  ): Promise<VoidSnapshot> => {
    const source = requireDatabase();
    const [purchase, account, memberships, grant, entries, segment] =
      await Promise.all([
        source
          .getRepository(MembershipPurchaseOrder)
          .findOneByOrFail({ id: fixture.purchase.id }),
        source
          .getRepository(MemberAccount)
          .findOneByOrFail({ id: fixture.account.id }),
        source.getRepository(UserMembership).find({
          where: { userId: fixture.user.id },
          order: { createdAt: 'ASC', id: 'ASC' },
        }),
        source
          .getRepository(MemberCreditGrant)
          .findOneByOrFail({ id: fixture.grant.id }),
        source.getRepository(MemberCreditEntry).find({
          where: { accountId: fixture.account.id },
          order: { createdAt: 'ASC', id: 'ASC' },
        }),
        source
          .getRepository(MembershipEntitlementSegment)
          .findOneByOrFail({ id: fixture.segment.id }),
      ]);
    return { purchase, account, memberships, grant, entries, segment };
  };

  beforeAll(async () => {
    try {
      cleanupDatabase = provisionMysqlTestDatabase(rootSql, DATABASE_OPTIONS);
      database = new DataSource({
        type: 'mysql',
        host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
        port: Number(process.env.TEST_MYSQL_PORT ?? 44306),
        database: DATABASE_NAME,
        username: APP_USER,
        password: process.env.TEST_MYSQL_APP_PASSWORD ?? 'bake_app_password',
        charset: 'utf8mb4',
        timezone: 'Z',
        synchronize: false,
        entities: Object.values(entities),
        migrations: [...DATABASE_MIGRATIONS],
        migrationsTableName: 'migrations',
        migrationsTransactionMode: 'each',
      });
      await database.initialize();
      await database.runMigrations();
      admin = await database.getRepository(AdminUser).save(
        database.getRepository(AdminUser).create({
          username: `void-admin-${randomUUID()}`,
          passwordHash: 'not-used-by-concurrency-test',
          isActive: true,
        }),
      );
      lowLevel = await saveLevel({
        code: 'VOID_CONCURRENCY_LOW',
        name: '作废验收低卡',
        rank: 110,
        grantCreditCents: DEBIT_AMOUNT_CENTS,
        validDays: 30,
        discountBasisPoints: 9_500,
        theme: MembershipTheme.CHAMPAGNE,
      });
      highLevel = await saveLevel({
        code: 'VOID_CONCURRENCY_HIGH',
        name: '作废验收高卡',
        rank: 120,
        grantCreditCents: 20_000,
        validDays: 60,
        discountBasisPoints: 9_000,
        theme: MembershipTheme.OBSIDIAN,
      });
      const audit = new AuditService(database.getRepository(AuditLog));
      const config = {
        get: () => ({ NODE_ENV: 'test', SIMULATED_PAYMENT_ENABLED: true }),
      };
      service = new MembershipPurchaseService(
        database.getRepository(MembershipPurchaseOrder),
        database.getRepository(MembershipLevel),
        database.getRepository(MemberAccount),
        database.getRepository(UserMembership),
        database.getRepository(MemberCreditGrant),
        database.getRepository(MemberCreditEntry),
        database.getRepository(IdempotencyRecord),
        database.getRepository(MembershipEntitlementSegment),
        database.getRepository(Order),
        database,
        new MembershipEntitlementService(),
        credit,
        audit,
        config as never,
        () => clock,
      );
    } catch (error) {
      if (database?.isInitialized) await database.destroy();
      cleanupDatabase?.();
      cleanupDatabase = undefined;
      throw error;
    }
  }, 60_000);

  beforeEach(() => {
    clock = CLOCK;
  });

  afterAll(async () => {
    try {
      if (database?.isInitialized) await database.destroy();
    } finally {
      cleanupDatabase?.();
      cleanupDatabase = undefined;
    }
    expect(mysqlTestDatabaseState(rootSql, DATABASE_OPTIONS)).toEqual({
      schemaCount: 0,
      grantCount: 0,
    });
  });

  it('serializes void against a transactional FIFO debit without leaking database failures', async () => {
    const source = requireDatabase();
    const fixture = await createAndPay(
      await createUser('13800000101'),
      lowLevel,
    );
    const debitOperationKey = `void-race-debit:${randomUUID()}`;

    const outcomes = await Promise.allSettled([
      service.voidPurchase(fixture.purchase.id, admin.id),
      debitInTransaction(fixture.user.id, debitOperationKey),
    ]);
    const successful = outcomes.filter(({ status }) => status === 'fulfilled');
    const voidSucceeded = outcomes[0]?.status === 'fulfilled';

    expect(successful).toHaveLength(1);
    expectDomainRejection(
      outcomes[voidSucceeded ? 1 : 0] as PromiseSettledResult<unknown>,
      voidSucceeded
        ? ApiErrorCode.MEMBER_CREDIT_INSUFFICIENT
        : ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
    );

    const [purchase, account, grants, entries] = await Promise.all([
      source
        .getRepository(MembershipPurchaseOrder)
        .findOneByOrFail({ id: fixture.purchase.id }),
      source
        .getRepository(MemberAccount)
        .findOneByOrFail({ id: fixture.account.id }),
      source.getRepository(MemberCreditGrant).find({
        where: { accountId: fixture.account.id },
      }),
      source.getRepository(MemberCreditEntry).find({
        where: { accountId: fixture.account.id },
      }),
    ]);
    const debitEntry = entries.find(
      ({ operationKey }) => operationKey === debitOperationKey,
    );
    const voidEntry = entries.find(
      ({ type }) =>
        type === MemberCreditEntryType.MEMBERSHIP_PURCHASE_VOID_REVERSAL,
    );
    const allocations = debitEntry
      ? await source.getRepository(MemberCreditAllocation).find({
          where: { creditEntryId: debitEntry.id },
        })
      : [];

    expect(account.availableCreditCents).toBe(
      grants
        .filter(({ status }) => status !== MemberCreditGrantStatus.REVERSED)
        .reduce((total, { remainingCents }) => total + remainingCents, 0),
    );
    expect(new Set(entries.map(({ operationKey }) => operationKey)).size).toBe(
      entries.length,
    );
    if (voidSucceeded) {
      expect(purchase.status).toBe(MembershipPurchaseStatus.VOIDED);
      expect(debitEntry).toBeUndefined();
      expect(voidEntry?.reversalOfEntryId).toBe(fixture.grantEntry.id);
    } else {
      expect(purchase.status).toBe(MembershipPurchaseStatus.FULFILLED);
      expect(voidEntry).toBeUndefined();
      expect(debitEntry).toMatchObject({
        amountCents: DEBIT_AMOUNT_CENTS,
        reversalOfEntryId: null,
      });
      expect(allocations).toHaveLength(1);
      expect(allocations[0]).toMatchObject({
        grantId: fixture.grant.id,
        amountCents: DEBIT_AMOUNT_CENTS,
      });
    }
    await expectCreditConservation(fixture.user.id);
  });

  it('allows exactly one of two concurrent voids and reverses membership credit once', async () => {
    const source = requireDatabase();
    const fixture = await createAndPay(
      await createUser('13800000102'),
      lowLevel,
    );

    const segmentBefore = segmentSnapshot(fixture.segment);
    const outcomes = await Promise.allSettled([
      service.voidPurchase(fixture.purchase.id, admin.id),
      service.voidPurchase(fixture.purchase.id, admin.id),
    ]);
    const successful = outcomes.filter(({ status }) => status === 'fulfilled');
    const rejected = outcomes.find(({ status }) => status === 'rejected');

    expect(successful).toHaveLength(1);
    expectDomainRejection(
      rejected as PromiseSettledResult<unknown>,
      ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
    );

    const [purchase, account, membership, grant, entries, segments, audits] =
      await Promise.all([
        source
          .getRepository(MembershipPurchaseOrder)
          .findOneByOrFail({ id: fixture.purchase.id }),
        source
          .getRepository(MemberAccount)
          .findOneByOrFail({ id: fixture.account.id }),
        source
          .getRepository(UserMembership)
          .findOneByOrFail({ id: fixture.membership.id }),
        source
          .getRepository(MemberCreditGrant)
          .findOneByOrFail({ id: fixture.grant.id }),
        source.getRepository(MemberCreditEntry).find({
          where: { accountId: fixture.account.id },
        }),
        source.getRepository(MembershipEntitlementSegment).find({
          where: { purchaseOrderId: fixture.purchase.id },
        }),
        source.getRepository(AuditLog).find({
          where: {
            targetEntity: 'membership_purchase_orders',
            targetId: fixture.purchase.id,
          },
        }),
      ]);
    const voidEntries = entries.filter(
      ({ type }) =>
        type === MemberCreditEntryType.MEMBERSHIP_PURCHASE_VOID_REVERSAL,
    );

    expect(purchase).toMatchObject({
      status: MembershipPurchaseStatus.VOIDED,
      paymentStatus: MembershipPaymentStatus.REVERSED,
    });
    expect(account).toMatchObject({
      activeMembershipId: null,
      availableCreditCents: 0,
    });
    expect(membership.status).toBe(MembershipStatus.VOIDED);
    expect(grant).toMatchObject({
      remainingCents: 0,
      status: MemberCreditGrantStatus.REVERSED,
    });
    expect(voidEntries).toHaveLength(1);
    expect(voidEntries[0]?.reversalOfEntryId).toBe(fixture.grantEntry.id);
    expect(segments).toHaveLength(1);
    expect(
      segmentSnapshot(segments[0] as MembershipEntitlementSegment),
    ).toEqual(segmentBefore);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('MEMBERSHIP_PURCHASE_VOIDED');
    await expectCreditConservation(fixture.user.id);
  });

  it('voids a real UPGRADE without deadlock and restores the previous membership exactly', async () => {
    const source = requireDatabase();
    const user = await createUser('13800000105');
    const previous = await createAndPay(user, lowLevel);
    const previousOriginalEndsAt = previous.membership.endsAt;
    clock = new Date('2026-07-22T08:00:00.000Z');
    const upgrade = await createAndPay(user, highLevel);

    await expect(
      service.voidPurchase(upgrade.purchase.id, admin.id),
    ).resolves.toMatchObject({
      purchase: {
        id: upgrade.purchase.id,
        status: MembershipPurchaseStatus.VOIDED,
        paymentStatus: MembershipPaymentStatus.REVERSED,
      },
    });

    const [account, restoredPrevious, voidedUpgrade, upgradeSegment] =
      await Promise.all([
        source
          .getRepository(MemberAccount)
          .findOneByOrFail({ userId: user.id }),
        source
          .getRepository(UserMembership)
          .findOneByOrFail({ id: previous.membership.id }),
        source
          .getRepository(UserMembership)
          .findOneByOrFail({ id: upgrade.membership.id }),
        source
          .getRepository(MembershipEntitlementSegment)
          .findOneByOrFail({ id: upgrade.segment.id }),
      ]);
    expect(account.activeMembershipId).toBe(restoredPrevious.id);
    expect(restoredPrevious).toMatchObject({
      id: previous.membership.id,
      endsAt: previousOriginalEndsAt,
      status: MembershipStatus.ACTIVE,
    });
    expect(voidedUpgrade.status).toBe(MembershipStatus.VOIDED);
    expect(segmentSnapshot(upgradeSegment)).toEqual(
      segmentSnapshot(upgrade.segment),
    );
    await expectCreditConservation(user.id);
  });

  it('rolls every membership mutation back when the real audit foreign key fails, then releases locks', async () => {
    const source = requireDatabase();
    const fixture = await createAndPay(
      await createUser('13800000103'),
      lowLevel,
    );
    const before = await snapshotVoidState(fixture);

    await expect(
      service.voidPurchase(fixture.purchase.id, '999999999999999999'),
    ).rejects.toSatisfy((error: unknown) => {
      expect(databaseErrorCode(error)).toBe('ER_NO_REFERENCED_ROW_2');
      return true;
    });

    const afterFailedAudit = await snapshotVoidState(fixture);
    expect(afterFailedAudit).toEqual(before);
    expect(
      await source.getRepository(AuditLog).countBy({
        targetEntity: 'membership_purchase_orders',
        targetId: fixture.purchase.id,
      }),
    ).toBe(0);

    await expect(
      service.voidPurchase(fixture.purchase.id, admin.id),
    ).resolves.toMatchObject({
      purchase: {
        id: fixture.purchase.id,
        status: MembershipPurchaseStatus.VOIDED,
      },
    });
    expect(
      await source.getRepository(AuditLog).countBy({
        targetEntity: 'membership_purchase_orders',
        targetId: fixture.purchase.id,
      }),
    ).toBe(1);
    await expectCreditConservation(fixture.user.id);
  });

  it('refuses to void an old LOW renewal after HIGH becomes the global membership-chain tail', async () => {
    const source = requireDatabase();
    const user = await createUser('13800000104');
    await createAndPay(user, lowLevel);
    const lowRenewal = await createAndPay(user, lowLevel);
    clock = new Date('2026-07-22T08:00:00.000Z');
    const highUpgrade = await createAndPay(user, highLevel);
    const before = await snapshotVoidState(lowRenewal);

    await expect(
      service.voidPurchase(lowRenewal.purchase.id, admin.id),
    ).rejects.toSatisfy((error: unknown) => {
      expect(domainErrorCode(error)).toBe(
        ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
      );
      expect(databaseErrorCode(error)).not.toBe('ER_LOCK_DEADLOCK');
      expect(databaseErrorCode(error)).not.toBe('ER_LOCK_WAIT_TIMEOUT');
      expect(databaseErrorCode(error)).not.toBe('ER_DUP_ENTRY');
      return true;
    });

    const after = await snapshotVoidState(lowRenewal);
    const [account, lowMembership, highMembership] = await Promise.all([
      source.getRepository(MemberAccount).findOneByOrFail({ userId: user.id }),
      source
        .getRepository(UserMembership)
        .findOneByOrFail({ id: lowRenewal.membership.id }),
      source
        .getRepository(UserMembership)
        .findOneByOrFail({ id: highUpgrade.membership.id }),
    ]);
    expect(after).toEqual(before);
    expect(account.activeMembershipId).toBe(highMembership.id);
    expect(highMembership.status).toBe(MembershipStatus.ACTIVE);
    expect(lowMembership.status).toBe(MembershipStatus.REPLACED);
    expect(
      await source.getRepository(AuditLog).countBy({
        targetEntity: 'membership_purchase_orders',
        targetId: lowRenewal.purchase.id,
      }),
    ).toBe(0);
    await expectCreditConservation(user.id);
  });
});
