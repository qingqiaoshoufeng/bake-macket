import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Address } from '../database/entities/address.entity.js';
import { CartItem } from '../database/entities/cart-item.entity.js';
import { Product } from '../database/entities/product.entity.js';
import { Sku } from '../database/entities/sku.entity.js';
import { User } from '../database/entities/user.entity.js';
import { UsersModule } from '../users/users.module.js';
import { AddressService } from './address.service.js';
import { CartService } from './cart.service.js';
import { MeController } from './me.controller.js';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([User, Address, CartItem, Product, Sku]),
  ],
  controllers: [MeController],
  providers: [AddressService, CartService],
  exports: [AddressService, CartService],
})
export class CustomerModule {}
