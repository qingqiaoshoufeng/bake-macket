import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CartItem } from '../database/entities/cart-item.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { UpsertCartItemDto } from './dto/cart.dto.js';

export type CartItemView = {
  id: string;
  quantity: number;
  available: boolean;
  sku: {
    id: string;
    name: string;
    attributes: Record<string, string>;
    priceCents: number;
    stock: number;
    imageUrl: string | null;
    isActive: boolean;
  };
  product: {
    id: string;
    name: string;
    coverImageUrl: string | null;
    isActive: boolean;
  };
};

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartItem)
    private readonly cartItems: Repository<CartItem>,
    @InjectRepository(Sku) private readonly skus: Repository<Sku>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  async list(userId: string): Promise<CartItemView[]> {
    const items = await this.cartItems.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
    return Promise.all(items.map((item) => this.toView(item)));
  }

  async upsert(userId: string, dto: UpsertCartItemDto): Promise<CartItemView> {
    await this.requireSku(dto.skuId);
    await this.cartItems.query(
      `INSERT INTO cart_items (user_id, sku_id, quantity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = LEAST(99, quantity + VALUES(quantity))`,
      [userId, dto.skuId, dto.quantity],
    );
    const item = await this.cartItems.findOneByOrFail({
      userId,
      skuId: dto.skuId,
    });
    return this.toView(item);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.cartItems.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('Cart item not found');
  }

  private async toView(item: CartItem): Promise<CartItemView> {
    const sku = await this.skus.findOneBy({ id: item.skuId });
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
    const product = await this.products.findOneBy({ id: sku.productId });
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

  private async requireSku(id: string): Promise<Sku> {
    const sku = await this.skus.findOneBy({ id });
    if (!sku) throw new NotFoundException('SKU not found');
    return sku;
  }
}
