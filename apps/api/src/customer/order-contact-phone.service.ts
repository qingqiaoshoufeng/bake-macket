import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ApiErrorCode, type OrderContactPhoneView } from '@bake-mall/contracts';
import { DataSource } from 'typeorm';

import { User } from '../database/entities/user.entity.js';

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function toOrderContactPhoneView(
  phone: string | null,
  version: number,
): OrderContactPhoneView {
  return phone
    ? { configured: true, maskedPhone: maskPhone(phone), version }
    : { configured: false, maskedPhone: null, version };
}

function isActiveUser(user: User): boolean {
  return user.isActive && user.mergedIntoUserId === null;
}

@Injectable()
export class OrderContactPhoneService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async update(
    userId: string,
    phone: string,
    expectedVersion: number,
  ): Promise<OrderContactPhoneView> {
    const normalizedPhone = phone.trim();
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('User not found');
      if (!isActiveUser(user)) throw new ConflictException('User is inactive');
      if (user.orderContactPhoneVersion !== expectedVersion) {
        throw new ConflictException({
          code: ApiErrorCode.ORDER_CONTACT_PHONE_UPDATE_VERSION_CONFLICT,
          message: '订单联系手机号已被其他请求更新，请刷新后重试',
        });
      }
      if (user.orderContactPhone === normalizedPhone) {
        return toOrderContactPhoneView(
          user.orderContactPhone,
          user.orderContactPhoneVersion,
        );
      }

      const nextVersion = user.orderContactPhoneVersion + 1;
      const result = await manager.getRepository(User).update(
        { id: user.id },
        {
          orderContactPhone: normalizedPhone,
          orderContactPhoneVersion: nextVersion,
        },
      );
      if (result.affected !== 1) {
        throw new ConflictException('User contact profile update failed');
      }
      return toOrderContactPhoneView(normalizedPhone, nextVersion);
    });
  }
}
