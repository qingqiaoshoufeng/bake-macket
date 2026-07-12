import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useCartStore } from './cart.js';

/**
 * Cart store contract pinned by Task 9.
 *
 * - `refresh()` pulls the current cart from `GET /me/cart/items` and
 *   exposes the items through the reactive `items` array.
 * - `setQuantity(id, quantity)` updates a cart item's quantity but clamps
 *   the value to `[1, 99]`, mirroring the backend's
 *   `UpsertCartItemDto.quantity` bounds. The backend upsert endpoint adds
 *   the supplied delta to the existing row, so the store computes the
 *   delta against the locally-cached row and sends it.
 * - `remove(id)` issues `DELETE /me/cart/items/:id` and drops the row from
 *   the local cache on success.
 *
 * Network calls go through the shared `ApiClient` (stubbed via `fetch`),
 * matching how `auth.spec.ts` exercises the same transport boundary.
 */

const cartPayload = [
  {
    id: 'cart-1',
    quantity: 2,
    available: true,
    sku: {
      id: 'sku-1',
      name: '6寸',
      attributes: { size: '6寸' },
      priceCents: 6800,
      stock: 3,
      imageUrl: null,
      isActive: true,
    },
    product: {
      id: 'product-1',
      name: '示例蛋糕',
      coverImageUrl: null,
      isActive: true,
    },
  },
  {
    id: 'cart-2',
    quantity: 1,
    available: false,
    sku: {
      id: 'sku-missing',
      name: '已下架',
      attributes: {},
      priceCents: 0,
      stock: 0,
      imageUrl: null,
      isActive: false,
    },
    product: {
      id: '',
      name: '',
      coverImageUrl: null,
      isActive: false,
    },
  },
];

describe('useCartStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('hydrates items from GET /me/cart/items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(cartPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const cart = useCartStore();
    await cart.refresh();

    expect(cart.items).toEqual(cartPayload);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/me/cart/items');
    expect(init.method).toBe('GET');
  });

  it('clamps setQuantity to 1-99 and posts the delta against the cached row', async () => {
    const seenRefresh = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (
          init?.method === 'GET' &&
          url.endsWith('/me/cart/items') &&
          seenRefresh.mock.calls.length === 0
        ) {
          seenRefresh();
          return new Response(JSON.stringify(cartPayload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(cartPayload[0]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const cart = useCartStore();
    await cart.refresh();

    fetchMock.mockClear();
    seenRefresh.mockClear();
    await cart.setQuantity('cart-1', 250);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toContain(
      '/api/v1/me/cart/items',
    );
    expect(
      JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ),
    ).toEqual({ skuId: 'sku-1', quantity: 97 });

    fetchMock.mockClear();
    await cart.setQuantity('cart-1', 0);
    expect(
      JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ),
    ).toEqual({ skuId: 'sku-1', quantity: -1 });

    fetchMock.mockClear();
    await cart.setQuantity('cart-1', 4);
    expect(
      JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ),
    ).toEqual({ skuId: 'sku-1', quantity: 2 });
  });

  it('skips the network call when the target equals the cached quantity', async () => {
    const seenRefresh2 = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (
          init?.method === 'GET' &&
          url.endsWith('/me/cart/items') &&
          seenRefresh2.mock.calls.length === 0
        ) {
          seenRefresh2();
          return new Response(JSON.stringify(cartPayload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(cartPayload[0]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const cart = useCartStore();
    await cart.refresh();

    fetchMock.mockClear();
    seenRefresh2.mockClear();
    const result = await cart.setQuantity('cart-1', 2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.id).toBe('cart-1');
  });

  it('removes the row from the local cache after a successful DELETE', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(cartPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const cart = useCartStore();
    await cart.refresh();
    expect(cart.items).toHaveLength(2);

    await cart.remove('cart-1');
    expect(cart.items.map((item) => item.id)).toEqual(['cart-2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/api/v1/me/cart/items/cart-1');
    expect(init.method).toBe('DELETE');
  });
});
