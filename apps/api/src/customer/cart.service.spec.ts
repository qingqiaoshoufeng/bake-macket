import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { CartItem } from '../database/entities/cart-item.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { User } from '../database/entities/user.entity.js';
import { UserIdentityService } from '../users/user-identity.service.js';
import { CartService } from './cart.service.js';

type UserState = Pick<User, 'id' | 'isActive' | 'mergedIntoUserId'> | null;

const buildHarness = (
  user: UserState = {
    id: 'user-1',
    isActive: true,
    mergedIntoUserId: null,
  },
) => {
  const cart = {
    id: 'cart-1',
    userId: 'user-1',
    skuId: 'sku-1',
    quantity: 1,
  };
  const sku = {
    id: 'sku-1',
    productId: 'product-1',
    name: '6 inch',
    attributes: {},
    priceCents: 6800,
    stock: 2,
    imageUrl: null,
    isActive: true,
  };
  const product = {
    id: 'product-1',
    name: 'Cake',
    coverImageUrl: null,
    isActive: true,
  };
  const cartItems = {
    query: vi.fn(),
    findOneByOrFail: vi.fn().mockResolvedValue(cart),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const skus = { findOneBy: vi.fn().mockResolvedValue(sku) };
  const products = { findOneBy: vi.fn().mockResolvedValue(product) };
  const setLock = vi.fn().mockReturnThis();
  const users = {
    createQueryBuilder: vi.fn(() => ({
      setLock,
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(user),
    })),
  };
  const manager = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === User) return users;
      if (entity === CartItem) return cartItems;
      if (entity === Sku) return skus;
      if (entity === Product) return products;
      throw new Error('unexpected entity');
    }),
  };
  const dataSource = {
    transaction: vi.fn(
      async <T>(callback: (value: typeof manager) => Promise<T>) =>
        callback(manager),
    ),
  };
  const identities = new UserIdentityService(dataSource as never);
  const service = Reflect.construct(CartService, [
    dataSource,
    cartItems,
    skus,
    products,
    identities,
  ]) as CartService;
  return { cartItems, dataSource, service, setLock };
};

const writeCases = [
  {
    name: 'upsert',
    run: (service: CartService) =>
      service.upsert('user-1', { skuId: 'sku-1', quantity: 2 }),
  },
  {
    name: 'remove',
    run: (service: CartService) => service.remove('user-1', 'cart-1'),
  },
] as const;

describe('CartService active write target', () => {
  it.each(writeCases)(
    '$name locks User before the cart write',
    async ({ run }) => {
      const { service, setLock } = buildHarness();

      await run(service);

      expect(setLock).toHaveBeenCalledWith('pessimistic_write');
    },
  );

  it.each(
    writeCases.flatMap((writeCase) => [
      {
        ...writeCase,
        state: 'inactive',
        user: { id: 'user-1', isActive: false, mergedIntoUserId: null },
      },
      {
        ...writeCase,
        state: 'merged',
        user: { id: 'user-1', isActive: true, mergedIntoUserId: 'canonical-1' },
      },
      { ...writeCase, state: 'missing', user: null },
    ]),
  )(
    '$name rejects a $state User without writing the cart repository',
    async ({ run, user }) => {
      const { cartItems, service, setLock } = buildHarness(user);

      await expect(run(service)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof UnauthorizedException && error.getStatus() === 401,
      );

      expect(setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(cartItems.query).not.toHaveBeenCalled();
      expect(cartItems.delete).not.toHaveBeenCalled();
    },
  );
});
