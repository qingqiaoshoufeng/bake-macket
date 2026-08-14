import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { CartItemView } from '@bake-mall/contracts';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { CartItem } from '../database/entities/cart-item.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { UserIdentityService } from '../users/user-identity.service.js';
import { UpsertCartItemDto } from './dto/cart.dto.js';

@Injectable()
export class CartService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CartItem)
    private readonly cartItems: Repository<CartItem>,
    @InjectRepository(Sku) private readonly skus: Repository<Sku>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly identities: UserIdentityService,
  ) {}

  async list(userId: string): Promise<CartItemView[]> {
    const items = await this.cartItems.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
    return Promise.all(items.map((item) => this.toView(item)));
  }

  upsert(userId: string, dto: UpsertCartItemDto): Promise<CartItemView> {
    return this.dataSource.transaction(async (manager) => {
      await this.identities.assertActiveWriteTarget(userId, manager);
      const sku = await this.requireSku(dto.skuId, manager);
      const cartItems = manager.getRepository(CartItem);
      await cartItems.query(
        `INSERT INTO cart_items (user_id, sku_id, quantity)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
        [userId, dto.skuId, dto.quantity],
      );
      const item = await cartItems.findOneByOrFail({
        userId,
        skuId: dto.skuId,
      });
      return this.toView(item, manager, sku);
    });
  }

  remove(userId: string, id: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      await this.identities.assertActiveWriteTarget(userId, manager);
      const result = await manager
        .getRepository(CartItem)
        .delete({ id, userId });
      if (!result.affected) throw new NotFoundException('Cart item not found');
    });
  }

  private async toView(
    item: CartItem,
    manager?: EntityManager,
    knownSku?: Sku,
  ): Promise<CartItemView> {
    const skus = manager?.getRepository(Sku) ?? this.skus;
    const products = manager?.getRepository(Product) ?? this.products;
    const sku = knownSku ?? (await skus.findOneBy({ id: item.skuId }));
    if (!sku) {
      return {
        id: item.id,
        quantity: item.quantity,
        available: false,
        sku: {
          id: item.skuId,
          name: '',
          attributes: {},
          priceCents: 0,
          stock: 0,
          imageUrl: null,
          isActive: false,
        },
        product: { id: '', name: '', coverImageUrl: null, isActive: false },
      };
    }
    const product = await products.findOneBy({ id: sku.productId });
    const available = Boolean(
      sku.isActive && sku.stock > 0 && product?.isActive,
    );
    return {
      id: item.id,
      quantity: item.quantity,
      available,
      sku: {
        id: sku.id,
        name: sku.name,
        attributes: sku.attributes,
        priceCents: sku.priceCents,
        stock: sku.stock,
        imageUrl: sku.imageUrl,
        isActive: sku.isActive,
      },
      product: product
        ? {
            id: product.id,
            name: product.name,
            coverImageUrl: product.coverImageUrl,
            isActive: product.isActive,
          }
        : { id: sku.productId, name: '', coverImageUrl: null, isActive: false },
    };
  }

  private async requireSku(id: string, manager: EntityManager): Promise<Sku> {
    const sku = await manager.getRepository(Sku).findOneBy({ id });
    if (!sku) throw new NotFoundException('SKU not found');
    return sku;
  }
}
