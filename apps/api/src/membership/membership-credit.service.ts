import { ConflictException, Injectable } from '@nestjs/common';
import {
  ApiErrorCode,
  MemberCreditDirection,
  MemberCreditEntryType,
  MemberCreditGrantStatus,
} from '@bake-mall/contracts';
import { type EntityManager, type Repository } from 'typeorm';

import { MemberAccount } from '../database/entities/member-account.entity.js';
import { MemberCreditAllocation } from '../database/entities/member-credit-allocation.entity.js';
import { MemberCreditEntry } from '../database/entities/member-credit-entry.entity.js';
import { MemberCreditGrant } from '../database/entities/member-credit-grant.entity.js';
import { type MembershipPurchaseOrder } from '../database/entities/membership-purchase-order.entity.js';

const INT_UNSIGNED_MAX = 4_294_967_295;

type DebitInput = {
  amountCents: number;
  referenceType: string;
  referenceId: string;
  operationKey: string;
};

type ReverseDebitInput = {
  originalEntryId: string;
  referenceType: string;
  referenceId: string;
  operationKey: string;
};

export type CreditMutationResult = {
  account: MemberAccount;
  entry: MemberCreditEntry | null;
  allocations: MemberCreditAllocation[];
};

@Injectable()
export class MembershipCreditService {
  async lockOrCreateAccount(
    manager: EntityManager,
    userId: string,
  ): Promise<MemberAccount> {
    const accounts = manager.getRepository(MemberAccount);
    const existing = await this.findLockedAccount(accounts, userId);
    if (existing) return existing;

    try {
      await accounts.save(
        accounts.create({
          userId,
          activeMembershipId: null,
          availableCreditCents: 0,
        }),
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
    }

    const account = await this.findLockedAccount(accounts, userId);
    if (!account) throw new ConflictException('会员账户创建失败');
    return account;
  }

  async grantMembershipPurchase(
    manager: EntityManager,
    account: MemberAccount,
    purchase: MembershipPurchaseOrder,
  ): Promise<CreditMutationResult> {
    this.assertUnsignedAmount(account.availableCreditCents);
    const amountCents = purchase.grantCreditCents;
    this.assertUnsignedAmount(amountCents);
    if (amountCents === 0) return this.emptyResult(account);

    const entries = manager.getRepository(MemberCreditEntry);
    const operationKey = `membership-purchase-grant:${purchase.id}`;
    const previous = await entries.findOne({ where: { operationKey } });
    if (previous) return { account, entry: previous, allocations: [] };

    const balanceAfterCents = this.addAmounts(
      account.availableCreditCents,
      amountCents,
    );
    const grants = manager.getRepository(MemberCreditGrant);
    await grants.save(
      grants.create({
        accountId: account.id,
        purchaseOrderId: purchase.id,
        grantedCents: amountCents,
        remainingCents: amountCents,
        status: MemberCreditGrantStatus.ACTIVE,
      }),
    );
    const savedAccount = await this.saveAccount(
      manager,
      account,
      balanceAfterCents,
    );
    const entry = await entries.save(
      entries.create({
        accountId: account.id,
        direction: MemberCreditDirection.CREDIT,
        type: MemberCreditEntryType.MEMBERSHIP_PURCHASE_GRANT,
        amountCents,
        balanceAfterCents,
        referenceType: 'MEMBERSHIP_PURCHASE',
        referenceId: purchase.id,
        operationKey,
        reversalOfEntryId: null,
      }),
    );
    return { account: savedAccount, entry, allocations: [] };
  }

  async reverseUnusedMembershipPurchaseGrant(
    manager: EntityManager,
    account: MemberAccount,
    purchase: MembershipPurchaseOrder,
  ): Promise<CreditMutationResult> {
    this.assertUnsignedAmount(account.availableCreditCents);
    const amountCents = purchase.grantCreditCents;
    this.assertUnsignedAmount(amountCents);
    if (amountCents === 0) return this.emptyResult(account);

    const entries = manager.getRepository(MemberCreditEntry);
    const operationKey = `membership-purchase-void:${purchase.id}`;
    const previous = await entries.findOne({ where: { operationKey } });
    if (previous) return { account, entry: previous, allocations: [] };

    const grants = manager.getRepository(MemberCreditGrant);
    const grant = await grants.findOne({
      where: { accountId: account.id, purchaseOrderId: purchase.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !grant ||
      grant.remainingCents !== grant.grantedCents ||
      grant.status !== MemberCreditGrantStatus.ACTIVE
    ) {
      throw this.purchaseNotVoidable();
    }
    const originalEntry = await entries.findOne({
      where: { operationKey: `membership-purchase-grant:${purchase.id}` },
      lock: { mode: 'pessimistic_write' },
    });
    if (!originalEntry) throw this.purchaseNotVoidable();

    const balanceAfterCents = this.subtractAmounts(
      account.availableCreditCents,
      amountCents,
    );
    await grants.save({
      ...grant,
      remainingCents: 0,
      status: MemberCreditGrantStatus.REVERSED,
    });
    const savedAccount = await this.saveAccount(
      manager,
      account,
      balanceAfterCents,
    );
    const entry = await entries.save(
      entries.create({
        accountId: account.id,
        direction: MemberCreditDirection.DEBIT,
        type: MemberCreditEntryType.MEMBERSHIP_PURCHASE_VOID_REVERSAL,
        amountCents,
        balanceAfterCents,
        referenceType: 'MEMBERSHIP_PURCHASE',
        referenceId: purchase.id,
        operationKey,
        reversalOfEntryId: originalEntry.id,
      }),
    );
    return { account: savedAccount, entry, allocations: [] };
  }

  async debitFifo(
    manager: EntityManager,
    account: MemberAccount,
    input: DebitInput,
  ): Promise<CreditMutationResult> {
    this.assertUnsignedAmount(account.availableCreditCents);
    this.assertUnsignedAmount(input.amountCents);
    if (input.amountCents === 0) return this.emptyResult(account);

    const entries = manager.getRepository(MemberCreditEntry);
    const previous = await entries.findOne({
      where: { operationKey: input.operationKey },
    });
    if (previous) {
      return {
        account,
        entry: previous,
        allocations: await this.allocationRepository(manager).find({
          where: { creditEntryId: previous.id },
        }),
      };
    }
    if (account.availableCreditCents < input.amountCents)
      throw this.insufficientCredit();

    const grants = await this.activeGrants(manager, account.id);
    const planned = this.planDebitAllocations(grants, input.amountCents);
    if (planned.remainingCents !== 0) throw this.insufficientCredit();

    const balanceAfterCents = this.subtractAmounts(
      account.availableCreditCents,
      input.amountCents,
    );
    await Promise.all(
      planned.items.map(({ grant, amountCents }) =>
        this.grantRepository(manager).save({
          ...grant,
          remainingCents: grant.remainingCents - amountCents,
          status:
            grant.remainingCents === amountCents
              ? MemberCreditGrantStatus.EXHAUSTED
              : MemberCreditGrantStatus.ACTIVE,
        }),
      ),
    );
    const savedAccount = await this.saveAccount(
      manager,
      account,
      balanceAfterCents,
    );
    const entry = await entries.save(
      entries.create({
        accountId: account.id,
        direction: MemberCreditDirection.DEBIT,
        type: MemberCreditEntryType.PRODUCT_ORDER_DEBIT,
        amountCents: input.amountCents,
        balanceAfterCents,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        operationKey: input.operationKey,
        reversalOfEntryId: null,
      }),
    );
    const allocations = await Promise.all(
      planned.items.map(({ grant, amountCents }) =>
        this.allocationRepository(manager).save(
          this.allocationRepository(manager).create({
            creditEntryId: entry.id,
            grantId: grant.id,
            amountCents,
          }),
        ),
      ),
    );
    return { account: savedAccount, entry, allocations };
  }

  async reverseDebit(
    manager: EntityManager,
    account: MemberAccount,
    input: ReverseDebitInput,
  ): Promise<CreditMutationResult> {
    this.assertUnsignedAmount(account.availableCreditCents);
    const entries = manager.getRepository(MemberCreditEntry);
    const previous = await entries.findOne({
      where: { operationKey: input.operationKey },
    });
    if (previous) {
      return {
        account,
        entry: previous,
        allocations: await this.allocationRepository(manager).find({
          where: { creditEntryId: previous.id },
        }),
      };
    }

    const allocations = this.allocationRepository(manager);
    const initialAllocations = await allocations.find({
      where: { creditEntryId: input.originalEntryId },
    });
    const allocatedGrants = await Promise.all(
      initialAllocations.map(async (allocation) => {
        const grant = await this.grantRepository(manager).findOne({
          where: { id: allocation.grantId, accountId: account.id },
        });
        if (!grant) throw new ConflictException('消费金来源不存在');
        return { allocation, grant };
      }),
    );
    const grants = await this.lockGrantsInFifoOrder(manager, allocatedGrants);
    const original = await entries.findOne({
      where: { id: input.originalEntryId, accountId: account.id },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !original ||
      original.direction !== MemberCreditDirection.DEBIT ||
      original.amountCents === 0
    ) {
      throw new ConflictException('原消费金扣款流水不存在');
    }
    const originalAllocations = await allocations.find({
      where: { creditEntryId: original.id },
      lock: { mode: 'pessimistic_write' },
    });
    const totalCents = originalAllocations.reduce(
      (total, allocation) => this.addAmounts(total, allocation.amountCents),
      0,
    );
    if (totalCents !== original.amountCents) {
      throw new ConflictException('原消费金扣款分配不完整');
    }
    if (!this.hasMatchingLockedGrants(originalAllocations, grants)) {
      throw new ConflictException('原消费金扣款来源已变更');
    }
    const lockedAllocationsByGrantId = new Map(
      grants.map(({ allocation }) => [allocation.grantId, allocation]),
    );
    const lockedGrants = grants.map(({ grant }) => grant);
    const balanceAfterCents = this.addAmounts(
      account.availableCreditCents,
      totalCents,
    );
    await Promise.all(
      lockedGrants.map((grant) => {
        const allocation = lockedAllocationsByGrantId.get(grant.id);
        if (!allocation) throw new ConflictException('原消费金扣款来源已变更');
        const remainingCents = this.addAmounts(
          grant.remainingCents,
          allocation.amountCents,
        );
        if (remainingCents > grant.grantedCents) {
          throw new ConflictException('消费金来源余额异常');
        }
        return this.grantRepository(manager).save({
          ...grant,
          remainingCents,
          status: MemberCreditGrantStatus.ACTIVE,
        });
      }),
    );
    const savedAccount = await this.saveAccount(
      manager,
      account,
      balanceAfterCents,
    );
    const entry = await entries.save(
      entries.create({
        accountId: account.id,
        direction: MemberCreditDirection.CREDIT,
        type: MemberCreditEntryType.PRODUCT_ORDER_CANCEL_REVERSAL,
        amountCents: totalCents,
        balanceAfterCents,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        operationKey: input.operationKey,
        reversalOfEntryId: original.id,
      }),
    );
    const reversalAllocations = await Promise.all(
      originalAllocations.map((allocation) =>
        this.allocationRepository(manager).save(
          this.allocationRepository(manager).create({
            creditEntryId: entry.id,
            grantId: allocation.grantId,
            amountCents: allocation.amountCents,
          }),
        ),
      ),
    );
    return { account: savedAccount, entry, allocations: reversalAllocations };
  }

  private async findLockedAccount(
    accounts: Repository<MemberAccount>,
    userId: string,
  ): Promise<MemberAccount | null> {
    return accounts.findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async activeGrants(
    manager: EntityManager,
    accountId: string,
  ): Promise<MemberCreditGrant[]> {
    return this.grantRepository(manager).find({
      where: { accountId, status: MemberCreditGrantStatus.ACTIVE },
      order: { createdAt: 'ASC', id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async lockGrantsInFifoOrder(
    manager: EntityManager,
    allocatedGrants: {
      allocation: MemberCreditAllocation;
      grant: MemberCreditGrant;
    }[],
  ): Promise<
    { allocation: MemberCreditAllocation; grant: MemberCreditGrant }[]
  > {
    const sorted = [...allocatedGrants].sort(
      ({ grant: left }, { grant: right }) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    );
    return sorted.reduce(
      async (pending, { allocation, grant: unlockedGrant }) => {
        const collected = await pending;
        const grant = await this.grantRepository(manager).findOne({
          where: { id: unlockedGrant.id, accountId: unlockedGrant.accountId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!grant) throw new ConflictException('消费金来源不存在');
        return [...collected, { allocation, grant }];
      },
      Promise.resolve(
        [] as {
          allocation: MemberCreditAllocation;
          grant: MemberCreditGrant;
        }[],
      ),
    );
  }

  private hasMatchingLockedGrants(
    allocations: MemberCreditAllocation[],
    grants: { allocation: MemberCreditAllocation; grant: MemberCreditGrant }[],
  ): boolean {
    const allocationGrantIds = [...allocations]
      .map(({ grantId }) => grantId)
      .sort((left, right) => left.localeCompare(right));
    const lockedGrantIds = [...grants]
      .map(({ grant }) => grant.id)
      .sort((left, right) => left.localeCompare(right));
    return (
      allocationGrantIds.length === lockedGrantIds.length &&
      allocationGrantIds.every(
        (grantId, index) => lockedGrantIds[index] === grantId,
      )
    );
  }

  private planDebitAllocations(
    grants: MemberCreditGrant[],
    amountCents: number,
  ): {
    items: { grant: MemberCreditGrant; amountCents: number }[];
    remainingCents: number;
  } {
    return grants.reduce(
      (plan, grant) => {
        const allocatedCents = Math.min(
          plan.remainingCents,
          grant.remainingCents,
        );
        return allocatedCents === 0
          ? plan
          : {
              items: [...plan.items, { grant, amountCents: allocatedCents }],
              remainingCents: plan.remainingCents - allocatedCents,
            };
      },
      {
        items: [] as { grant: MemberCreditGrant; amountCents: number }[],
        remainingCents: amountCents,
      },
    );
  }

  private async saveAccount(
    manager: EntityManager,
    account: MemberAccount,
    availableCreditCents: number,
  ): Promise<MemberAccount> {
    return this.accountRepository(manager).save({
      ...account,
      availableCreditCents,
    });
  }

  private accountRepository(manager: EntityManager): Repository<MemberAccount> {
    return manager.getRepository(MemberAccount);
  }

  private grantRepository(
    manager: EntityManager,
  ): Repository<MemberCreditGrant> {
    return manager.getRepository(MemberCreditGrant);
  }

  private allocationRepository(
    manager: EntityManager,
  ): Repository<MemberCreditAllocation> {
    return manager.getRepository(MemberCreditAllocation);
  }

  private emptyResult(account: MemberAccount): CreditMutationResult {
    return { account, entry: null, allocations: [] };
  }

  private assertUnsignedAmount(amountCents: number): void {
    if (
      !Number.isSafeInteger(amountCents) ||
      amountCents < 0 ||
      amountCents > INT_UNSIGNED_MAX
    ) {
      throw new ConflictException('消费金金额超出允许范围');
    }
  }

  private addAmounts(left: number, right: number): number {
    const total = left + right;
    this.assertUnsignedAmount(total);
    return total;
  }

  private subtractAmounts(left: number, right: number): number {
    const total = left - right;
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new ConflictException('消费金余额不足');
    }
    return total;
  }

  private insufficientCredit(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.MEMBER_CREDIT_INSUFFICIENT,
      message: '消费金余额不足',
    });
  }

  private purchaseNotVoidable(): ConflictException {
    return new ConflictException({
      code: ApiErrorCode.MEMBERSHIP_PURCHASE_NOT_VOIDABLE,
      message: '当前购卡记录不满足作废条件',
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ER_DUP_ENTRY'
    );
  }
}
