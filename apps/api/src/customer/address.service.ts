import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { AddressView } from '@bake-mall/contracts';
import { DataSource, Repository } from 'typeorm';

import { Address } from '../database/entities/address.entity.js';
import { UserIdentityService } from '../users/user-identity.service.js';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto.js';

@Injectable()
export class AddressService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
    private readonly identities: UserIdentityService,
  ) {}

  async list(userId: string): Promise<AddressView[]> {
    const items = await this.addresses.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
    return items.map(toAddressView);
  }

  create(userId: string, dto: CreateAddressDto): Promise<AddressView> {
    return this.dataSource.transaction(async (manager) => {
      await this.identities.assertActiveWriteTarget(userId, manager);
      const addresses = manager.getRepository(Address);
      const isDefault = dto.isDefault ?? false;
      if (isDefault) await this.clearDefaults(addresses, userId);
      const saved = await addresses.save(
        addresses.create({
          userId,
          recipient: dto.receiverName,
          phone: dto.phone,
          province: dto.province,
          city: dto.city,
          district: dto.district,
          detail: dto.detail,
          isDefault,
        }),
      );
      return toAddressView(saved);
    });
  }

  update(
    userId: string,
    id: string,
    dto: UpdateAddressDto,
  ): Promise<AddressView> {
    return this.dataSource.transaction(async (manager) => {
      await this.identities.assertActiveWriteTarget(userId, manager);
      const addresses = manager.getRepository(Address);
      const address = await addresses.findOneBy({ id, userId });
      if (!address) throw new NotFoundException('Address not found');
      const isDefault = dto.isDefault ?? address.isDefault;
      if (isDefault) await this.clearDefaults(addresses, userId);
      const values = {
        recipient: dto.receiverName ?? address.recipient,
        phone: dto.phone ?? address.phone,
        province: dto.province ?? address.province,
        city: dto.city ?? address.city,
        district: dto.district ?? address.district,
        detail: dto.detail ?? address.detail,
        isDefault,
      };
      const result = await addresses.update({ id, userId }, values);
      if (!result.affected) throw new NotFoundException('Address not found');
      return toAddressView({ ...address, ...values });
    });
  }

  setDefault(userId: string, id: string): Promise<AddressView> {
    return this.dataSource.transaction(async (manager) => {
      await this.identities.assertActiveWriteTarget(userId, manager);
      const addresses = manager.getRepository(Address);
      const address = await addresses.findOneBy({ id, userId });
      if (!address) throw new NotFoundException('Address not found');
      await this.clearDefaults(addresses, userId);
      const result = await addresses.update(
        { id, userId },
        { isDefault: true },
      );
      if (!result.affected) throw new NotFoundException('Address not found');
      return toAddressView({ ...address, isDefault: true });
    });
  }

  remove(userId: string, id: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      await this.identities.assertActiveWriteTarget(userId, manager);
      const result = await manager
        .getRepository(Address)
        .delete({ id, userId });
      if (!result.affected) throw new NotFoundException('Address not found');
    });
  }

  private clearDefaults(addresses: Repository<Address>, userId: string) {
    return addresses.update({ userId, isDefault: true }, { isDefault: false });
  }
}

function toAddressView(address: Address): AddressView {
  return {
    id: address.id,
    recipient: address.recipient,
    phone: address.phone,
    province: address.province,
    city: address.city,
    district: address.district,
    detail: address.detail,
    isDefault: address.isDefault,
    ...(address.createdAt
      ? { createdAt: address.createdAt.toISOString() }
      : {}),
    ...(address.updatedAt
      ? { updatedAt: address.updatedAt.toISOString() }
      : {}),
  };
}
