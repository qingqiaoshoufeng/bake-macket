import 'reflect-metadata';

import {
  ApiErrorCode,
  MemberCreditDirection,
  MemberCreditEntryType,
  MembershipEntitlementSegmentKind,
  MembershipPaymentStatus,
  MembershipPurchaseStatus,
  MembershipStatus,
  MembershipTheme,
} from '@bake-mall/contracts';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as entities from '../src/database/entities/index.js';
import { IdempotencyRecord } from '../src/database/entities/idempotency-record.entity.js';
import { MemberAccount } from '../src/database/entities/member-account.entity.js';
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

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const DATABASE_NAME = `bake_mall_membership_payment_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const APP_USER = process.env.TEST_MYSQL_APP_USER ?? 'bake_app';
const DATABASE_OPTIONS = { databaseName: DATABASE_NAME, appUser: APP_USER };

type LevelFixture = {
  code: string;
  name: string;
  rank: number;
  grantCreditCents: number;
  validDays: number;
  discountBasisPoints: number;
  theme: MembershipTheme;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MILLISECONDS);
}

function errorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return undefined;
  }
  const response = (error as { response?: unknown }).response;
  return typeof response === 'object' && response !== null && 'code' in response
    ? (response as { code?: unknown }).code
    : undefined;
}

describe.sequential('membership simulated payment concurrency (MySQL)', () => {
  const rootSql = createDockerRootSqlExecutor();
  let cleanupDatabase: (() => void) | undefined;
  let database: DataSource | undefined;
  let service: MembershipPurchaseService;
  let clock = new Date('2026-07-21T08:00:00.000Z');
  let lowLevel: MembershipLevel;
  let highLevel: MembershipLevel;

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

  const createPurchase = async (userId: string, levelId: string) =>
    service.createPurchase(userId, `create-${randomUUID()}`, { levelId });

  const pay = async (userId: string, purchaseId: string) =>
    service.simulatePayment(userId, purchaseId, `payment-${randomUUID()}`);

  const saveLevel = async (fixture: LevelFixture): Promise<MembershipLevel> => {
    const source = requireDatabase();
    return source.getRepository(MembershipLevel).save(
      source.getRepository(MembershipLevel).create({
        ...fixture,
        subtitle: null,
        description: null,
        priceCents: 50_000,
        benefits: [{ title: `${fixture.name}权益`, sortOrder: 10 }],
        badgeText: fixture.code,
        sortOrder: fixture.rank,
        isActive: true,
      }),
    );
  };

  const expectCreditConservation = async (
    userId: string,
    expectedPurchases: { id: string; grantCreditCents: number }[],
  ): Promise<void> => {
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
    const expectedCreditCents = expectedPurchases.reduce(
      (total, purchase) => total + purchase.grantCreditCents,
      0,
    );
    expect(grants).toHaveLength(expectedPurchases.length);
    expect(entries).toHaveLength(expectedPurchases.length);
    expect(account.availableCreditCents).toBe(expectedCreditCents);
    expect(
      grants.reduce((total, grant) => total + grant.remainingCents, 0),
    ).toBe(expectedCreditCents);

    expectedPurchases.forEach((purchase) => {
      const matchingGrants = grants.filter(
        ({ purchaseOrderId }) => purchaseOrderId === purchase.id,
      );
      const matchingEntries = entries.filter(
        ({ referenceType, referenceId }) =>
          referenceType === 'MEMBERSHIP_PURCHASE' &&
          referenceId === purchase.id,
      );
      expect(matchingGrants).toHaveLength(1);
      expect(matchingGrants[0]).toMatchObject({
        grantedCents: purchase.grantCreditCents,
        remainingCents: purchase.grantCreditCents,
      });
      expect(matchingEntries).toHaveLength(1);
      expect(matchingEntries[0]).toMatchObject({
        direction: MemberCreditDirection.CREDIT,
        type: MemberCreditEntryType.MEMBERSHIP_PURCHASE_GRANT,
        amountCents: purchase.grantCreditCents,
        operationKey: `membership-purchase-grant:${purchase.id}`,
      });
    });
    expect(entries.map(({ balanceAfterCents }) => balanceAfterCents)).toEqual(
      entries.reduce(
        (balances, entry) => [
          ...balances,
          (balances.at(-1) ?? 0) + entry.amountCents,
        ],
        [] as number[],
      ),
    );
    expect(entries.at(-1)?.balanceAfterCents).toBe(expectedCreditCents);
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
      lowLevel = await saveLevel({
        code: 'PAYMENT_CONCURRENCY_LOW',
        name: '并发验收金卡',
        rank: 110,
        grantCreditCents: 10_000,
        validDays: 30,
        discountBasisPoints: 9_500,
        theme: MembershipTheme.CHAMPAGNE,
      });
      highLevel = await saveLevel({
        code: 'PAYMENT_CONCURRENCY_HIGH',
        name: '并发验收黑卡',
        rank: 120,
        grantCreditCents: 20_000,
        validDays: 60,
        discountBasisPoints: 9_000,
        theme: MembershipTheme.OBSIDIAN,
      });
      const config = {
        get: () => ({ NODE_ENV: 'test', SIMULATED_PAYMENT_ENABLED: true }),
      };
      const audit = { record: async () => undefined };
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
        new MembershipCreditService(),
        audit as never,
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

  it('fulfills one purchase exactly once when two payment keys race', async () => {
    const source = requireDatabase();
    clock = new Date('2026-07-21T08:00:00.000Z');
    const user = await createUser('13800000001');
    const purchase = await createPurchase(user.id, lowLevel.id);

    const results = await Promise.all([
      pay(user.id, purchase.id),
      pay(user.id, purchase.id),
    ]);

    const [savedPurchase, memberships, segments, account] = await Promise.all([
      source
        .getRepository(MembershipPurchaseOrder)
        .findOneByOrFail({ id: purchase.id }),
      source.getRepository(UserMembership).find({ where: { userId: user.id } }),
      source.getRepository(MembershipEntitlementSegment).find({
        where: { purchaseOrderId: purchase.id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      source.getRepository(MemberAccount).findOneByOrFail({ userId: user.id }),
    ]);
    const [grants, entries] = await Promise.all([
      source.getRepository(MemberCreditGrant).find({
        where: { accountId: account.id, purchaseOrderId: purchase.id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      source.getRepository(MemberCreditEntry).find({
        where: {
          accountId: account.id,
          referenceType: 'MEMBERSHIP_PURCHASE',
          referenceId: purchase.id,
        },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
    ]);

    expect(results).toHaveLength(2);
    expect(
      results.every(
        ({ status }) => status === MembershipPurchaseStatus.FULFILLED,
      ),
    ).toBe(true);
    expect(savedPurchase).toMatchObject({
      status: MembershipPurchaseStatus.FULFILLED,
      paymentStatus: MembershipPaymentStatus.SUCCEEDED,
    });
    expect(memberships).toHaveLength(1);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      membershipId: memberships[0]?.id,
      kind: MembershipEntitlementSegmentKind.INITIAL,
    });
    expect(grants).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(account.activeMembershipId).toBe(memberships[0]?.id);
    await expectCreditConservation(user.id, [
      { id: purchase.id, grantCreditCents: lowLevel.grantCreditCents },
    ]);
  });

  it('serializes two same-level renewals into one continuous membership timeline', async () => {
    const source = requireDatabase();
    clock = new Date('2026-08-01T08:00:00.000Z');
    const user = await createUser('13800000002');
    const initialPurchase = await createPurchase(user.id, lowLevel.id);
    await pay(user.id, initialPurchase.id);
    const baseline = await source
      .getRepository(UserMembership)
      .findOneByOrFail({ userId: user.id });
    const [firstRenewal, secondRenewal] = await Promise.all([
      createPurchase(user.id, lowLevel.id),
      createPurchase(user.id, lowLevel.id),
    ]);

    await Promise.all([
      pay(user.id, firstRenewal.id),
      pay(user.id, secondRenewal.id),
    ]);

    const [memberships, segments, purchases] = await Promise.all([
      source.getRepository(UserMembership).find({ where: { userId: user.id } }),
      source.getRepository(MembershipEntitlementSegment).find({
        where: { membershipId: baseline.id },
        order: { startsAt: 'ASC', id: 'ASC' },
      }),
      source.getRepository(MembershipPurchaseOrder).find({
        where: { userId: user.id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
    ]);
    const expectedFinalEndsAt = addDays(
      baseline.endsAt,
      lowLevel.validDays * 2,
    );

    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.endsAt).toEqual(expectedFinalEndsAt);
    expect(segments.map(({ kind }) => kind)).toEqual([
      MembershipEntitlementSegmentKind.INITIAL,
      MembershipEntitlementSegmentKind.RENEWAL,
      MembershipEntitlementSegmentKind.RENEWAL,
    ]);
    expect(segments).toHaveLength(3);
    expect(segments[0]?.endsAt).toEqual(segments[1]?.startsAt);
    expect(segments[1]?.endsAt).toEqual(segments[2]?.startsAt);
    expect(segments[2]?.endsAt).toEqual(expectedFinalEndsAt);
    expect(
      purchases.every(
        ({ status, paymentStatus }) =>
          status === MembershipPurchaseStatus.FULFILLED &&
          paymentStatus === MembershipPaymentStatus.SUCCEEDED,
      ),
    ).toBe(true);
    await expectCreditConservation(user.id, [
      {
        id: initialPurchase.id,
        grantCreditCents: lowLevel.grantCreditCents,
      },
      { id: firstRenewal.id, grantCreditCents: lowLevel.grantCreditCents },
      { id: secondRenewal.id, grantCreditCents: lowLevel.grantCreditCents },
    ]);
  });

  it('allows only a legal serial outcome when an upgrade races a lower-level renewal', async () => {
    const source = requireDatabase();
    const initialPaidAt = new Date('2026-09-01T08:00:00.000Z');
    clock = initialPaidAt;
    const user = await createUser('13800000003');
    const initialPurchase = await createPurchase(user.id, lowLevel.id);
    await pay(user.id, initialPurchase.id);
    const baseline = await source
      .getRepository(UserMembership)
      .findOneByOrFail({ userId: user.id });
    const baselineEndsAt = baseline.endsAt;
    const [renewal, upgrade] = await Promise.all([
      createPurchase(user.id, lowLevel.id),
      createPurchase(user.id, highLevel.id),
    ]);
    const upgradeClock = addDays(initialPaidAt, 1);
    clock = upgradeClock;

    const outcomes = await Promise.allSettled([
      pay(user.id, renewal.id),
      pay(user.id, upgrade.id),
    ]);

    const [account, memberships, segments, purchases] = await Promise.all([
      source.getRepository(MemberAccount).findOneByOrFail({ userId: user.id }),
      source.getRepository(UserMembership).find({
        where: { userId: user.id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      source.getRepository(MembershipEntitlementSegment).find({
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      source.getRepository(MembershipPurchaseOrder).find({
        where: { userId: user.id },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
    ]);
    const userSegments = segments.filter(({ purchaseOrderId }) =>
      purchases.some((purchase) => purchase.id === purchaseOrderId),
    );
    const activeMemberships = memberships.filter(
      ({ status }) => status === MembershipStatus.ACTIVE,
    );
    const lowMembership = memberships.find(
      ({ membershipLevelId }) => membershipLevelId === lowLevel.id,
    );
    const highMembership = memberships.find(
      ({ membershipLevelId }) => membershipLevelId === highLevel.id,
    );
    const upgradeSegment = userSegments.find(
      ({ purchaseOrderId }) => purchaseOrderId === upgrade.id,
    );
    const renewalSucceeded = outcomes[0]?.status === 'fulfilled';

    expect(outcomes[1]?.status).toBe('fulfilled');
    expect(activeMemberships).toHaveLength(1);
    expect(activeMemberships[0]?.membershipLevelId).toBe(highLevel.id);
    expect(account.activeMembershipId).toBe(highMembership?.id);
    expect(highMembership).toMatchObject({
      status: MembershipStatus.ACTIVE,
      startsAt: upgradeClock,
      endsAt: addDays(upgradeClock, highLevel.validDays),
    });
    expect(highMembership?.startsAt.getTime()).toBeLessThanOrEqual(
      clock.getTime(),
    );
    expect(highMembership?.endsAt.getTime()).toBeGreaterThan(clock.getTime());
    expect(lowMembership).toMatchObject({
      status: MembershipStatus.REPLACED,
      endsAt: upgradeClock,
    });
    expect(upgradeSegment).toMatchObject({
      kind: MembershipEntitlementSegmentKind.UPGRADE,
      membershipId: highMembership?.id,
      previousMembershipId: baseline.id,
      startsAt: upgradeClock,
      endsAt: addDays(upgradeClock, highLevel.validDays),
    });

    if (renewalSucceeded) {
      expect(purchases).toHaveLength(3);
      expect(
        purchases.every(
          ({ status, paymentStatus }) =>
            status === MembershipPurchaseStatus.FULFILLED &&
            paymentStatus === MembershipPaymentStatus.SUCCEEDED,
        ),
      ).toBe(true);
      expect(userSegments).toHaveLength(3);
      expect(upgradeSegment?.previousMembershipEndsAt).toEqual(
        addDays(baselineEndsAt, lowLevel.validDays),
      );
      await expectCreditConservation(user.id, [
        {
          id: initialPurchase.id,
          grantCreditCents: lowLevel.grantCreditCents,
        },
        { id: renewal.id, grantCreditCents: lowLevel.grantCreditCents },
        { id: upgrade.id, grantCreditCents: highLevel.grantCreditCents },
      ]);
    } else {
      const renewalOutcome = outcomes[0];
      expect(renewalOutcome?.status).toBe('rejected');
      expect(
        errorCode(
          renewalOutcome?.status === 'rejected'
            ? renewalOutcome.reason
            : undefined,
        ),
      ).toBe(ApiErrorCode.MEMBERSHIP_DOWNGRADE_NOT_ALLOWED);
      expect(purchases.find(({ id }) => id === renewal.id)).toMatchObject({
        status: MembershipPurchaseStatus.PENDING,
        paymentStatus: MembershipPaymentStatus.PENDING,
      });
      expect(userSegments).toHaveLength(2);
      expect(
        userSegments.some(
          ({ purchaseOrderId }) => purchaseOrderId === renewal.id,
        ),
      ).toBe(false);
      const failedRenewalGrants = await source
        .getRepository(MemberCreditGrant)
        .find({ where: { purchaseOrderId: renewal.id } });
      const failedRenewalEntries = await source
        .getRepository(MemberCreditEntry)
        .find({
          where: {
            accountId: account.id,
            referenceType: 'MEMBERSHIP_PURCHASE',
            referenceId: renewal.id,
          },
          order: { createdAt: 'ASC', id: 'ASC' },
        });
      expect(failedRenewalGrants).toHaveLength(0);
      expect(failedRenewalEntries).toHaveLength(0);
      expect(upgradeSegment?.previousMembershipEndsAt).toEqual(baselineEndsAt);
      await expectCreditConservation(user.id, [
        {
          id: initialPurchase.id,
          grantCreditCents: lowLevel.grantCreditCents,
        },
        { id: upgrade.id, grantCreditCents: highLevel.grantCreditCents },
      ]);
    }
  });
});
