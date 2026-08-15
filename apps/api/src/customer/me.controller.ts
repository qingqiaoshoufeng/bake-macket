import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { CustomerProfileView } from '@bake-mall/contracts';
import { Repository } from 'typeorm';

import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtUserGuard } from '../auth/user-jwt.guard.js';
import { User } from '../database/entities/user.entity.js';
import { AddressService } from './address.service.js';
import { CartService } from './cart.service.js';
import { UpdateOrderContactPhoneDto } from './dto/order-contact-phone.dto.js';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto.js';
import {
  OrderContactPhoneService,
  toOrderContactPhoneView,
} from './order-contact-phone.service.js';
import { UpsertCartItemDto } from './dto/cart.dto.js';

@Controller('me')
@UseGuards(JwtUserGuard)
export class MeController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly addresses: AddressService,
    private readonly carts: CartService,
    private readonly orderContactPhones: OrderContactPhoneService,
  ) {}

  @Get()
  async profile(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<CustomerProfileView> {
    const user = await this.users.findOneByOrFail({ id: currentUser.id });
    return {
      id: user.id,
      avatarUrl: user.avatarUrl,
      nickname: user.nickname,
      phone: maskPhone(user.phone),
      phoneVerified: user.phoneVerified,
      orderContactPhone: toOrderContactPhoneView(
        user.orderContactPhone,
        user.orderContactPhoneVersion,
      ),
    };
  }

  @Put('order-contact-phone')
  updateOrderContactPhone(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpdateOrderContactPhoneDto,
  ) {
    return this.orderContactPhones.update(
      currentUser.id,
      dto.phone,
      dto.expectedVersion,
    );
  }

  @Get('cart/items')
  listCart(@CurrentUser() user: AuthenticatedUser) {
    return this.carts.list(user.id);
  }

  @Post('cart/items')
  upsertCart(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertCartItemDto,
  ) {
    return this.carts.upsert(user.id, dto);
  }

  @Delete('cart/items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCart(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.carts.remove(user.id, id);
  }

  @Get('addresses')
  listAddresses(@CurrentUser() user: AuthenticatedUser) {
    return this.addresses.list(user.id);
  }

  @Post('addresses')
  createAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAddressDto,
  ) {
    return this.addresses.create(user.id, dto);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addresses.update(user.id, id, dto);
  }

  @Patch('addresses/:id/default')
  setDefaultAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.addresses.setDefault(user.id, id);
  }

  @Delete('addresses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.addresses.remove(user.id, id);
  }
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length < 7) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}
