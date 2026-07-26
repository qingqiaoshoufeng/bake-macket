import { computed, onScopeDispose, readonly, ref, watch, type Ref } from 'vue';
import type {
  FulfillmentType,
  OrderQuoteRequest,
  OrderQuoteView,
} from '@bake-mall/contracts';

import { yuanTextToCents } from '../../../utils/money.js';

export type OrderQuoteIntent = {
  cartItemIds: readonly string[];
  cartVersion: string;
  fulfillmentType: FulfillmentType;
};

type UseOrderQuoteOptions = {
  intent: Readonly<Ref<OrderQuoteIntent>>;
  request: (body: OrderQuoteRequest) => Promise<OrderQuoteView>;
  debounceMs: number;
  now?: () => Date;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '报价失败，请稍后重试';
}

export function useOrderQuote({
  intent,
  request,
  debounceMs,
  now = () => new Date(),
}: UseOrderQuoteOptions) {
  const requestedCreditText = ref('0');
  const quote = ref<OrderQuoteView | null>(null);
  const validationError = ref<string | null>(null);
  const error = ref<string | null>(null);
  const loading = ref(false);
  const requiresConfirmation = ref(false);
  const confirmedToken = ref<string | null>(null);
  const refreshVersion = ref(0);
  const activeRequestId = ref(0);
  const disposed = ref(false);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  function invalidate(message: string | null = null): void {
    activeRequestId.value += 1;
    quote.value = null;
    confirmedToken.value = null;
    error.value = message;
    loading.value = false;
  }

  function requestedCreditCents(): number | null {
    try {
      const cents = yuanTextToCents(requestedCreditText.value);
      validationError.value = null;
      return cents;
    } catch (parseError) {
      validationError.value = messageOf(parseError);
      return null;
    }
  }

  async function executeQuote(): Promise<void> {
    const cents = requestedCreditCents();
    if (cents === null || !intent.value.cartItemIds.length || disposed.value) {
      loading.value = false;
      return;
    }
    const requestId = activeRequestId.value + 1;
    activeRequestId.value = requestId;
    loading.value = true;
    error.value = null;
    try {
      const result = await request({
        cartItemIds: [...intent.value.cartItemIds],
        requestedCreditCents: cents,
      });
      if (disposed.value || requestId !== activeRequestId.value) return;
      quote.value = result;
      confirmedToken.value = requiresConfirmation.value
        ? null
        : result.quoteToken;
    } catch (requestError) {
      if (disposed.value || requestId !== activeRequestId.value) return;
      quote.value = null;
      confirmedToken.value = null;
      error.value = messageOf(requestError);
    } finally {
      if (!disposed.value && requestId === activeRequestId.value) {
        loading.value = false;
      }
    }
  }

  function scheduleQuote(): void {
    clearTimer();
    const cents = requestedCreditCents();
    if (cents === null) {
      activeRequestId.value += 1;
      confirmedToken.value = null;
      loading.value = false;
      return;
    }
    invalidate();
    if (!intent.value.cartItemIds.length || disposed.value) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void executeQuote();
    }, debounceMs);
  }

  function updateRequestedCreditText(value: string): void {
    requestedCreditText.value = value;
  }

  function confirmLatest(): void {
    if (!quote.value) return;
    requiresConfirmation.value = false;
    confirmedToken.value = quote.value.quoteToken;
    error.value = null;
  }

  function refresh(): void {
    refreshVersion.value += 1;
  }

  function markStale(message = '报价已失效，请确认新金额后再次下单'): void {
    requiresConfirmation.value = true;
    invalidate(message);
    refresh();
  }

  function requireUsableQuote(): OrderQuoteView | null {
    const current = quote.value;
    if (!current || new Date(current.expiresAt).getTime() <= now().getTime()) {
      requiresConfirmation.value = true;
      invalidate('报价已过期，正在刷新，请确认新金额后再次下单');
      refresh();
      return null;
    }
    return confirmedToken.value === current.quoteToken ? current : null;
  }

  watch(
    [
      () => intent.value.cartItemIds.join(','),
      () => intent.value.cartVersion,
      () => intent.value.fulfillmentType,
      requestedCreditText,
      refreshVersion,
    ],
    scheduleQuote,
    { immediate: true },
  );

  onScopeDispose(() => {
    disposed.value = true;
    clearTimer();
    activeRequestId.value += 1;
    loading.value = false;
  });

  const canUseQuote = computed(() =>
    Boolean(
      quote.value &&
      confirmedToken.value === quote.value.quoteToken &&
      !validationError.value &&
      !loading.value,
    ),
  );

  return {
    data: {
      requestedCreditText: readonly(requestedCreditText),
      quote: readonly(quote),
      validationError: readonly(validationError),
      error: readonly(error),
      requiresConfirmation: readonly(requiresConfirmation),
    },
    loading: readonly(loading),
    canUseQuote,
    methods: {
      updateRequestedCreditText,
      confirmLatest,
      markStale,
      requireUsableQuote,
      refresh,
    },
  };
}
