import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Address } from '../database/entities/address.entity.js';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto.js';

@Injectable()
export class AddressService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Address) private readonly addresses: Repository<Address>,
  ) {}

  list(userId: string): Promise<Address[]> {
    return this.addresses.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  create(userId: string, dto: CreateAddressDto): Promise<Address> {
    return this.dataSource.transaction(async (manager) => {
      const addresses = manager.getRepository(Address);
      const isDefault = dto.isDefault ?? false;
      if (isDefault) await this.clearDefaults(addresses, userId);
      return addresses.save(
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
    });
  }

  update(userId: string, id: string, dto: UpdateAddressDto): Promise<Address> {
    return this.dataSource.transaction(async (manager) => {
      const addresses = manager.getRepository(Address);
      const address = await addresses.findOneBy({ id, userId });
      if (!address) throw new NotFoundException('Address not found');
      const isDefault = dto.isDefault ?? address.isDefault;
      if (isDefault) await this.clearDefaults(addresses, userId);
      return addresses.save(
        Object.assign(address, {
          recipient: dto.receiverName ?? address.recipient,
          phone: dto.phone ?? address.phone,
          province: dto.province ?? address.province,
          city: dto.city ?? address.city,
          district: dto.district ?? address.district,
          detail: dto.detail ?? address.detail,
          isDefault,
        }),
      );
    });
  }

  setDefault(userId: string, id: string): Promise<Address> {
    return this.dataSource.transaction(async (manager) => {
      const addresses = manager.getRepository(Address);
      const address = await addresses.findOneBy({ id, userId });
      if (!address) throw new NotFoundException('Address not found');
      await this.clearDefaults(addresses, userId);
      address.isDefault = true;
      return addresses.save(address);
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.addresses.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('Address not found');
  }

  private clearDefaults(addresses: Repository<Address>, userId: string) {
    return addresses.update({ userId, isDefault: true }, { isDefault: false });
  }
}
