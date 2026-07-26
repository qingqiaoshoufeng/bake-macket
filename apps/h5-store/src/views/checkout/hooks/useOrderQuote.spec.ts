import { effectScope, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FulfillmentType,
  MembershipStatus,
  MembershipTheme,
} from '@bake-mall/contracts';
import type { OrderQuoteRequest, OrderQuoteView } from '@bake-mall/contracts';

import { useOrderQuote } from './useOrderQuote.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function quote(overrides: Partial<OrderQuoteView> = {}): OrderQuoteView {
  return {
    lines: [],
    goodsTotalCents: 6800,
    membershipDiscountCents: 680,
    discountedTotalCents: 6120,
    availableCreditCents: 3000,
    maxCreditCents: 3000,
    requestedCreditCents: 0,
    creditAppliedCents: 0,
    payableTotalCents: 6120,
    membership: {
      id: 'membership-1',
      levelId: 'level-1',
      code: 'GOLD',
      name: '金卡',
      rank: 2,
      discountBasisPoints: 9000,
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2027-07-01T00:00:00.000Z',
      status: MembershipStatus.ACTIVE,
      cardTheme: {
        theme: MembershipTheme.CHAMPAGNE,
        badgeText: '金卡会员',
      },
      benefits: [{ title: '全场九折', sortOrder: 0 }],
    },
    quoteToken: 'quote-token',
    expiresAt: '2026-07-26T12:05:00.000Z',
    ...overrides,
  };
}

function flushPromises(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

describe('useOrderQuote', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('debounces intent changes and sends exact requested cents', async () => {
    vi.useFakeTimers();
    const intent = ref({
      cartItemIds: ['cart-1'],
      cartVersion: 'cart-1:1',
      fulfillmentType: FulfillmentType.PICKUP,
    });
    const request = vi
      .fn<(body: OrderQuoteRequest) => Promise<OrderQuoteView>>()
      .mockResolvedValue(quote({ requestedCreditCents: 1234 }));
    const scope = effectScope();
    const state = scope.run(() =>
      useOrderQuote({ intent, request, debounceMs: 300 }),
    )!;

    state.methods.updateRequestedCreditText('12');
    state.methods.updateRequestedCreditText('12.3');
    state.methods.updateRequestedCreditText('12.34');
    await vi.advanceTimersByTimeAsync(299);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      cartItemIds: ['cart-1'],
      requestedCreditCents: 1234,
    });
    scope.stop();
  });

  it('rejects imprecise credit input without replacing the last quote', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue(quote());
    const scope = effectScope();
    const state = scope.run(() =>
      useOrderQuote({
        intent: ref({
          cartItemIds: ['cart-1'],
          cartVersion: 'cart-1:1',
          fulfillmentType: FulfillmentType.PICKUP,
        }),
        request,
        debounceMs: 1,
      }),
    )!;
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    const previous = state.data.quote.value;

    state.methods.updateRequestedCreditText('0.001');
    await vi.advanceTimersByTimeAsync(1);

    expect(state.data.validationError.value).toContain('两位小数');
    expect(state.data.quote.value).toBe(previous);
    expect(state.canUseQuote.value).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('allows only the latest response, error, and finally state to apply', async () => {
    vi.useFakeTimers();
    const first = deferred<OrderQuoteView>();
    const second = deferred<OrderQuoteView>();
    const request = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const intent = ref({
      cartItemIds: ['cart-1'],
      cartVersion: 'cart-1:1',
      fulfillmentType: FulfillmentType.PICKUP,
    });
    const scope = effectScope();
    const state = scope.run(() =>
      useOrderQuote({ intent, request, debounceMs: 10 }),
    )!;
    await vi.advanceTimersByTimeAsync(10);
    intent.value = { ...intent.value, cartVersion: 'cart-1:2' };
    await vi.advanceTimersByTimeAsync(10);

    first.reject(new Error('旧报价失败'));
    await flushPromises();
    expect(state.loading.value).toBe(true);
    expect(state.data.error.value).toBeNull();

    second.resolve(quote({ quoteToken: 'latest-token' }));
    await flushPromises();
    expect(state.data.quote.value?.quoteToken).toBe('latest-token');
    expect(state.loading.value).toBe(false);
    scope.stop();
  });

  it('invalidates quote on fulfillment or cart intent changes', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue(quote());
    const intent = ref({
      cartItemIds: ['cart-1'],
      cartVersion: 'cart-1:1',
      fulfillmentType: FulfillmentType.PICKUP,
    });
    const scope = effectScope();
    const state = scope.run(() =>
      useOrderQuote({ intent, request, debounceMs: 10 }),
    )!;
    await vi.advanceTimersByTimeAsync(10);
    await flushPromises();
    expect(state.canUseQuote.value).toBe(true);

    intent.value = {
      ...intent.value,
      fulfillmentType: FulfillmentType.DELIVERY,
    };
    await flushPromises();
    expect(state.data.quote.value).toBeNull();
    expect(state.canUseQuote.value).toBe(false);

    await vi.advanceTimersByTimeAsync(10);
    expect(request).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it('ignores a late response after its scope is disposed', async () => {
    vi.useFakeTimers();
    const pending = deferred<OrderQuoteView>();
    const scope = effectScope();
    const state = scope.run(() =>
      useOrderQuote({
        intent: ref({
          cartItemIds: ['cart-1'],
          cartVersion: 'cart-1:1',
          fulfillmentType: FulfillmentType.PICKUP,
        }),
        request: () => pending.promise,
        debounceMs: 1,
      }),
    )!;
    await vi.advanceTimersByTimeAsync(1);
    scope.stop();
    pending.resolve(quote({ quoteToken: 'late-token' }));
    await flushPromises();

    expect(state.data.quote.value).toBeNull();
    expect(state.loading.value).toBe(false);
  });

  it('clears an expired token, refreshes, and requires explicit confirmation', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        quote({
          quoteToken: 'expired-token',
          expiresAt: '2026-07-26T11:59:59.000Z',
        }),
      )
      .mockResolvedValueOnce(quote({ quoteToken: 'fresh-token' }));
    const scope = effectScope();
    const state = scope.run(() =>
      useOrderQuote({
        intent: ref({
          cartItemIds: ['cart-1'],
          cartVersion: 'cart-1:1',
          fulfillmentType: FulfillmentType.PICKUP,
        }),
        request,
        debounceMs: 1,
        now: () => new Date('2026-07-26T12:00:00.000Z'),
      }),
    )!;
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();

    expect(state.methods.requireUsableQuote()).toBeNull();
    expect(state.data.quote.value).toBeNull();
    expect(state.data.requiresConfirmation.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(state.data.quote.value?.quoteToken).toBe('fresh-token');
    expect(state.canUseQuote.value).toBe(false);

    state.methods.confirmLatest();
    expect(state.canUseQuote.value).toBe(true);
    scope.stop();
  });

  it('refreshes a stale quote without clearing credit input', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValue(quote({ quoteToken: 'fresh-token' }));
    const scope = effectScope();
    const state = scope.run(() =>
      useOrderQuote({
        intent: ref({
          cartItemIds: ['cart-1'],
          cartVersion: 'cart-1:1',
          fulfillmentType: FulfillmentType.PICKUP,
        }),
        request,
        debounceMs: 1,
      }),
    )!;
    state.methods.updateRequestedCreditText('8.88');
    state.methods.markStale('报价已失效，请确认新金额');

    expect(state.data.requestedCreditText.value).toBe('8.88');
    expect(state.data.quote.value).toBeNull();
    expect(state.data.requiresConfirmation.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(state.data.quote.value?.quoteToken).toBe('fresh-token');
    expect(state.canUseQuote.value).toBe(false);
    scope.stop();
  });
});
