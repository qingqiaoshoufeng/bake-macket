import { ConflictException } from '@nestjs/common';
import {
  ApiErrorCode,
  MemberCreditDirection,
  MemberCreditEntryType,
  MemberCreditGrantStatus,
} from '@bake-mall/contracts';
import { describe, expect, it, vi } from 'vitest';

import { MemberAccount } from '../database/entities/member-account.entity.js';
import { MemberCreditAllocation } from '../database/entities/member-credit-allocation.entity.js';
import { MemberCreditEntry } from '../database/entities/member-credit-entry.entity.js';
import { MemberCreditGrant } from '../database/entities/member-credit-grant.entity.js';
import { MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';
import { MembershipCreditService } from './membership-credit.service.js';

const now = new Date('2026-07-23T08:00:00.000Z');

const purchase = (overrides: Partial<MembershipPurchaseOrder> = {}) =>
  ({
    id: 'purchase-1',
    grantCreditCents: 100,
    ...overrides,
  }) as MembershipPurchaseOrder;

const account = (overrides: Partial<MemberAccount> = {}) =>
  ({
    id: 'account-1',
    userId: 'user-1',
    activeMembershipId: null,
    availableCreditCents: 0,
    version: 1,
    ...overrides,
  }) as MemberAccount;

const grant = (overrides: Partial<MemberCreditGrant> = {}) =>
  ({
    id: 'grant-1',
    accountId: 'account-1',
    purchaseOrderId: 'purchase-1',
    grantedCents: 100,
    remainingCents: 100,
    status: MemberCreditGrantStatus.ACTIVE,
    createdAt: now,
    ...overrides,
  }) as MemberCreditGrant;

const buildService = ({
  accounts = [],
  grants = [],
  entries = [],
  allocations = [],
}: {
  accounts?: MemberAccount[];
  grants?: MemberCreditGrant[];
  entries?: MemberCreditEntry[];
  allocations?: MemberCreditAllocation[];
} = {}) => {
  let accountRows = [...accounts];
  let grantRows = [...grants];
  let entryRows = [...entries];
  let allocationRows = [...allocations];
  const locks: unknown[] = [];
  const lockedEntities: unknown[] = [];
  const persist = <T extends { id?: string }>(
    rows: T[],
    value: T,
    prefix: string,
  ): T => {
    const saved = {
      ...value,
      id: value.id ?? `${prefix}-${rows.length + 1}`,
    } as T;
    const nextRows = rows.some((row) => row.id === saved.id)
      ? rows.map((row) => (row.id === saved.id ? saved : row))
      : [...rows, saved];
    if (prefix === 'account')
      accountRows = nextRows as unknown as MemberAccount[];
    if (prefix === 'grant')
      grantRows = nextRows as unknown as MemberCreditGrant[];
    if (prefix === 'entry')
      entryRows = nextRows as unknown as MemberCreditEntry[];
    if (prefix === 'allocation')
      allocationRows = nextRows as unknown as MemberCreditAllocation[];
    return saved;
  };
  const matches = (
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ) => Object.entries(where).every(([key, value]) => row[key] === value);
  const accountRepository = {
    findOne: vi.fn(
      async (options: { where: Record<string, unknown>; lock?: unknown }) => {
        locks.push(options.lock);
        if (options.lock) lockedEntities.push('account');
        return (
          accountRows.find((row) =>
            matches(row as unknown as Record<string, unknown>, options.where),
          ) ?? null
        );
      },
    ),
    create: vi.fn((value: MemberAccount) => value),
    save: vi.fn(async (value: MemberAccount) =>
      persist(accountRows, value, 'account'),
    ),
  };
  const grantRepository = {
    findOne: vi.fn(
      async (options: { where: Record<string, unknown>; lock?: unknown }) => {
        locks.push(options.lock);
        if (options.lock) lockedEntities.push(`grant:${options.where.id}`);
        return (
          grantRows.find((row) =>
            matches(row as unknown as Record<string, unknown>, options.where),
          ) ?? null
        );
      },
    ),
    find: vi.fn(
      async (options: {
        where: Record<string, unknown>;
        order?: unknown;
        lock?: unknown;
      }) => {
        locks.push(options.lock);
        return grantRows
          .filter((row) =>
            matches(row as unknown as Record<string, unknown>, options.where),
          )
          .sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime() ||
              left.id.localeCompare(right.id),
          );
      },
    ),
    create: vi.fn((value: MemberCreditGrant) => value),
    save: vi.fn(async (value: MemberCreditGrant) =>
      persist(grantRows, value, 'grant'),
    ),
  };
  const entryRepository = {
    findOne: vi.fn(
      async (options: { where: Record<string, unknown>; lock?: unknown }) => {
        locks.push(options.lock);
        if (options.lock) lockedEntities.push('entry');
        return (
          entryRows.find((row) =>
            matches(row as unknown as Record<string, unknown>, options.where),
          ) ?? null
        );
      },
    ),
    create: vi.fn((value: MemberCreditEntry) => value),
    save: vi.fn(async (value: MemberCreditEntry) =>
      persist(entryRows, value, 'entry'),
    ),
  };
  const allocationRepository = {
    find: vi.fn(
      async (options: { where: Record<string, unknown>; lock?: unknown }) => {
        locks.push(options.lock);
        if (options.lock) lockedEntities.push('allocations');
        return allocationRows.filter((row) =>
          matches(row as unknown as Record<string, unknown>, options.where),
        );
      },
    ),
    create: vi.fn((value: MemberCreditAllocation) => value),
    save: vi.fn(async (value: MemberCreditAllocation) =>
      persist(allocationRows, value, 'allocation'),
    ),
  };
  const repositories = new Map<unknown, object>([
    [MemberAccount, accountRepository],
    [MemberCreditGrant, grantRepository],
    [MemberCreditEntry, entryRepository],
    [MemberCreditAllocation, allocationRepository],
  ]);
  const manager = {
    getRepository: vi.fn((entity: unknown) => repositories.get(entity)),
  };
  return {
    service: new MembershipCreditService(),
    manager,
    rows: () => ({
      accounts: accountRows,
      grants: grantRows,
      entries: entryRows,
      allocations: allocationRows,
    }),
    locks,
    lockedEntities,
  };
};

describe('MembershipCreditService', () => {
  it('creates a missing account then rereads it with a pessimistic write lock', async () => {
    const { service, manager, rows, locks } = buildService();

    const result = await service.lockOrCreateAccount(
      manager as never,
      'user-1',
    );

    expect(result).toMatchObject({ userId: 'user-1', availableCreditCents: 0 });
    expect(rows().accounts).toHaveLength(1);
    expect(locks.filter(Boolean)).toEqual([
      { mode: 'pessimistic_write' },
      { mode: 'pessimistic_write' },
    ]);
  });

  it('grants a purchase once and preserves account-grant-entry conservation on repeat', async () => {
    const initial = account();
    const { service, manager, rows } = buildService({ accounts: [initial] });

    const first = await service.grantMembershipPurchase(
      manager as never,
      initial,
      purchase(),
    );
    const repeated = await service.grantMembershipPurchase(
      manager as never,
      first.account,
      purchase(),
    );

    expect(first.entry).toMatchObject({
      direction: MemberCreditDirection.CREDIT,
      type: MemberCreditEntryType.MEMBERSHIP_PURCHASE_GRANT,
      amountCents: 100,
      balanceAfterCents: 100,
      operationKey: 'membership-purchase-grant:purchase-1',
    });
    expect(repeated.entry?.id).toBe(first.entry?.id);
    expect(rows().grants).toEqual([
      expect.objectContaining({
        remainingCents: 100,
        status: MemberCreditGrantStatus.ACTIVE,
      }),
    ]);
    expect(rows().accounts.at(-1)?.availableCreditCents).toBe(100);
    expect(rows().entries).toHaveLength(1);
  });

  it('treats zero purchase credit as a no-op and rejects UINT overflow', async () => {
    const zero = buildService({ accounts: [account()] });
    const zeroResult = await zero.service.grantMembershipPurchase(
      zero.manager as never,
      account(),
      purchase({ grantCreditCents: 0 }),
    );
    expect(zeroResult).toMatchObject({ entry: null, allocations: [] });
    expect(zero.rows()).toMatchObject({ grants: [], entries: [] });

    const overflowing = buildService({
      accounts: [account({ availableCreditCents: 4_294_967_295 })],
    });
    await expect(
      overflowing.service.grantMembershipPurchase(
        overflowing.manager as never,
        account({ availableCreditCents: 4_294_967_295 }),
        purchase({ grantCreditCents: 1 }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(overflowing.rows().grants).toEqual([]);
  });

  it('debits active grants FIFO and records exact source allocations', async () => {
    const firstGrant = grant({
      id: 'grant-old',
      remainingCents: 40,
      grantedCents: 40,
      createdAt: new Date('2026-07-20T08:00:00.000Z'),
    });
    const secondGrant = grant({
      id: 'grant-new',
      purchaseOrderId: 'purchase-2',
      remainingCents: 100,
      createdAt: now,
    });
    const initial = account({ availableCreditCents: 140 });
    const { service, manager, rows } = buildService({
      accounts: [initial],
      grants: [secondGrant, firstGrant],
    });

    const result = await service.debitFifo(manager as never, initial, {
      amountCents: 90,
      referenceType: 'ORDER',
      referenceId: 'order-1',
      operationKey: 'order-debit:order-1',
    });

    expect(result.entry).toMatchObject({
      direction: MemberCreditDirection.DEBIT,
      type: MemberCreditEntryType.PRODUCT_ORDER_DEBIT,
      amountCents: 90,
      balanceAfterCents: 50,
    });
    expect(rows().grants).toEqual([
      expect.objectContaining({
        id: 'grant-new',
        remainingCents: 50,
        status: MemberCreditGrantStatus.ACTIVE,
      }),
      expect.objectContaining({
        id: 'grant-old',
        remainingCents: 0,
        status: MemberCreditGrantStatus.EXHAUSTED,
      }),
    ]);
    expect(
      rows().allocations.map(({ grantId, amountCents }) => ({
        grantId,
        amountCents,
      })),
    ).toEqual([
      { grantId: 'grant-old', amountCents: 40 },
      { grantId: 'grant-new', amountCents: 50 },
    ]);
    expect(rows().accounts.at(-1)?.availableCreditCents).toBe(50);
  });

  it('rejects insufficient debit without changing ledger state and treats zero debit as no-op', async () => {
    const initial = account({ availableCreditCents: 40 });
    const insufficient = buildService({
      accounts: [initial],
      grants: [grant({ remainingCents: 40, grantedCents: 40 })],
    });
    await expect(
      insufficient.service.debitFifo(insufficient.manager as never, initial, {
        amountCents: 41,
        referenceType: 'ORDER',
        referenceId: 'order-1',
        operationKey: 'order-debit:order-1',
      }),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBER_CREDIT_INSUFFICIENT,
      });
      return true;
    });
    expect(insufficient.rows().grants[0]?.remainingCents).toBe(40);
    expect(insufficient.rows().entries).toEqual([]);

    const zero = buildService({
      accounts: [initial],
      grants: [grant({ remainingCents: 40, grantedCents: 40 })],
    });
    await expect(
      zero.service.debitFifo(zero.manager as never, initial, {
        amountCents: 0,
        referenceType: 'ORDER',
        referenceId: 'order-1',
        operationKey: 'order-debit:order-1',
      }),
    ).resolves.toMatchObject({ entry: null, allocations: [] });
    expect(zero.rows().entries).toEqual([]);
  });

  it('locks reversal grants in FIFO order before locking the original entry', async () => {
    const initial = account({ availableCreditCents: 50 });
    const original = {
      id: 'entry-debit',
      accountId: initial.id,
      direction: MemberCreditDirection.DEBIT,
      type: MemberCreditEntryType.PRODUCT_ORDER_DEBIT,
      amountCents: 90,
      balanceAfterCents: 50,
      operationKey: 'order-debit:order-1',
    } as MemberCreditEntry;
    const { service, manager, locks, lockedEntities } = buildService({
      accounts: [initial],
      grants: [
        grant({
          id: 'grant-new',
          purchaseOrderId: 'purchase-2',
          remainingCents: 50,
          grantedCents: 100,
          createdAt: now,
        }),
        grant({
          id: 'grant-old',
          remainingCents: 0,
          grantedCents: 40,
          status: MemberCreditGrantStatus.EXHAUSTED,
          createdAt: new Date('2026-07-20T08:00:00.000Z'),
        }),
      ],
      entries: [original],
      allocations: [
        {
          id: 'allocation-1',
          creditEntryId: original.id,
          grantId: 'grant-new',
          amountCents: 50,
        },
        {
          id: 'allocation-2',
          creditEntryId: original.id,
          grantId: 'grant-old',
          amountCents: 40,
        },
      ] as MemberCreditAllocation[],
    });

    await service.reverseDebit(manager as never, initial, {
      originalEntryId: original.id,
      referenceType: 'ORDER',
      referenceId: 'order-1',
      operationKey: 'order-cancel:order-1',
    });

    expect(locks.filter(Boolean)).toEqual([
      { mode: 'pessimistic_write' },
      { mode: 'pessimistic_write' },
      { mode: 'pessimistic_write' },
      { mode: 'pessimistic_write' },
    ]);
    expect(lockedEntities).toEqual([
      'grant:grant-old',
      'grant:grant-new',
      'entry',
      'allocations',
    ]);
  });

  it('reverses a debit to its original grants only and remains idempotent', async () => {
    const initial = account({ availableCreditCents: 50 });
    const original = {
      id: 'entry-debit',
      accountId: initial.id,
      direction: MemberCreditDirection.DEBIT,
      type: MemberCreditEntryType.PRODUCT_ORDER_DEBIT,
      amountCents: 90,
      balanceAfterCents: 50,
      operationKey: 'order-debit:order-1',
    } as MemberCreditEntry;
    const { service, manager, rows } = buildService({
      accounts: [initial],
      grants: [
        grant({
          id: 'grant-old',
          remainingCents: 0,
          grantedCents: 40,
          status: MemberCreditGrantStatus.EXHAUSTED,
        }),
        grant({
          id: 'grant-new',
          purchaseOrderId: 'purchase-2',
          remainingCents: 50,
          grantedCents: 100,
        }),
      ],
      entries: [original],
      allocations: [
        {
          id: 'allocation-1',
          creditEntryId: original.id,
          grantId: 'grant-old',
          amountCents: 40,
        },
        {
          id: 'allocation-2',
          creditEntryId: original.id,
          grantId: 'grant-new',
          amountCents: 50,
        },
      ] as MemberCreditAllocation[],
    });
    const input = {
      originalEntryId: original.id,
      referenceType: 'ORDER',
      referenceId: 'order-1',
      operationKey: 'order-cancel:order-1',
    };

    const first = await service.reverseDebit(manager as never, initial, input);
    const repeated = await service.reverseDebit(
      manager as never,
      first.account,
      input,
    );

    expect(first.entry).toMatchObject({
      direction: MemberCreditDirection.CREDIT,
      type: MemberCreditEntryType.PRODUCT_ORDER_CANCEL_REVERSAL,
      amountCents: 90,
      balanceAfterCents: 140,
      reversalOfEntryId: original.id,
    });
    expect(repeated.entry?.id).toBe(first.entry?.id);
    expect(
      rows().grants.map(({ id, remainingCents, status }) => ({
        id,
        remainingCents,
        status,
      })),
    ).toEqual([
      {
        id: 'grant-old',
        remainingCents: 40,
        status: MemberCreditGrantStatus.ACTIVE,
      },
      {
        id: 'grant-new',
        remainingCents: 100,
        status: MemberCreditGrantStatus.ACTIVE,
      },
    ]);
    expect(
      rows()
        .allocations.filter((item) => item.creditEntryId === first.entry?.id)
        .map(({ grantId, amountCents }) => ({ grantId, amountCents }))
        .sort((left, right) => left.grantId.localeCompare(right.grantId)),
    ).toEqual([
      { grantId: 'grant-new', amountCents: 50 },
      { grantId: 'grant-old', amountCents: 40 },
    ]);
    expect(rows().accounts.at(-1)?.availableCreditCents).toBe(140);
  });

  it('reverses only an entirely unused purchase grant and links the reversal to its grant entry', async () => {
    const initial = account({ availableCreditCents: 100 });
    const issued = {
      id: 'entry-grant',
      accountId: initial.id,
      direction: MemberCreditDirection.CREDIT,
      type: MemberCreditEntryType.MEMBERSHIP_PURCHASE_GRANT,
      amountCents: 100,
      balanceAfterCents: 100,
      operationKey: 'membership-purchase-grant:purchase-1',
    } as MemberCreditEntry;
    const unused = buildService({
      accounts: [initial],
      grants: [grant()],
      entries: [issued],
    });

    const result = await unused.service.reverseUnusedMembershipPurchaseGrant(
      unused.manager as never,
      initial,
      purchase(),
    );

    expect(result.entry).toMatchObject({
      direction: MemberCreditDirection.DEBIT,
      type: MemberCreditEntryType.MEMBERSHIP_PURCHASE_VOID_REVERSAL,
      reversalOfEntryId: issued.id,
      balanceAfterCents: 0,
    });
    expect(unused.rows().grants[0]).toMatchObject({
      remainingCents: 0,
      status: MemberCreditGrantStatus.REVERSED,
    });
    expect(unused.rows().accounts.at(-1)?.availableCreditCents).toBe(0);

    const used = buildService({
      accounts: [initial],
      grants: [grant({ remainingCents: 50 })],
      entries: [issued],
    });
    await expect(
      used.service.reverseUnusedMembershipPurchaseGrant(
        used.manager as never,
        initial,
        purchase(),
      ),
    ).rejects.toSatisfy((error: ConflictException) => {
      expect(error.getResponse()).toMatchObject({
        code: ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
      });
      return true;
    });
  });
});
