import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { User } from '../database/entities/user.entity.js';

const PHONE_PATTERN = /^\+?\d{6,20}$/;
const OPERATOR_PHONE_PATTERN = /^1\d{10}$/;

export const normalizePhone = (phone: string): string => {
  const normalized = phone.trim();
  if (!PHONE_PATTERN.test(normalized)) {
    throw new BadRequestException(
      'phone must be 6-20 digits, optionally prefixed with +',
    );
  }
  return normalized;
};

/** Canonical phone format shared by OPERATOR login and admin-created users. */
export const normalizeOperatorPhone = (phone: string): string => {
  const normalized = phone.trim();
  if (!OPERATOR_PHONE_PATTERN.test(normalized)) {
    throw new BadRequestException('phone must be an 11-digit mainland number');
  }
  return normalized;
};

type WechatIdentity = Readonly<{
  openid: string;
  unionid: string | null;
}>;

type PhoneIdentityChange = {
  userId: string;
  phone: string | null;
  phoneVerified: boolean;
  forceTokenVersionIncrement?: boolean;
};

const normalizePhoneIdentity = (
  change: Pick<PhoneIdentityChange, 'phone' | 'phoneVerified'>,
): string | null => {
  if (change.phone === null) {
    if (change.phoneVerified) {
      throw new BadRequestException('Verified phone must be valid');
    }
    return null;
  }
  return normalizePhone(change.phone);
};

@Injectable()
export class UserIdentityService {
  constructor(private readonly dataSource: DataSource) {}

  async createWechatUser(
    identity: WechatIdentity,
    manager: EntityManager,
  ): Promise<User> {
    const users = manager.getRepository(User);
    return users.save(
      users.create({
        wechatOpenid: identity.openid,
        wechatUnionid: identity.unionid,
        nickname: null,
        avatarUrl: null,
        phone: null,
        phoneVerified: false,
        isActive: true,
        mergedIntoUserId: null,
        tokenVersion: 1,
      }),
    );
  }

  async createPhonePlaceholder(
    phone: string,
    manager: EntityManager,
  ): Promise<User> {
    const normalizedPhone = normalizeOperatorPhone(phone);
    const users = manager.getRepository(User);
    return users.save(
      users.create({
        wechatOpenid: null,
        wechatUnionid: null,
        nickname: null,
        avatarUrl: null,
        phone: normalizedPhone,
        phoneVerified: false,
        isActive: true,
        mergedIntoUserId: null,
        tokenVersion: 1,
      }),
    );
  }

  async assertActiveWriteTarget(
    userId: string,
    manager: EntityManager,
  ): Promise<User> {
    const user = await manager
      .getRepository(User)
      .createQueryBuilder('user')
      .setLock('pessimistic_write')
      .where('user.id = :userId', { userId })
      .getOne();
    if (!user || !user.isActive || user.mergedIntoUserId !== null) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return user;
  }

  async setVerifiedPhone(
    userId: string,
    phone: string,
    manager?: EntityManager,
  ): Promise<User> {
    return this.setPhoneIdentity(
      {
        userId,
        phone: normalizePhone(phone),
        phoneVerified: true,
        forceTokenVersionIncrement: true,
      },
      manager,
    );
  }

  async setPhoneIdentity(
    change: PhoneIdentityChange,
    manager?: EntityManager,
  ): Promise<User> {
    normalizePhoneIdentity(change);
    const operation = async (transaction: EntityManager): Promise<User> => {
      const user = await transaction
        .getRepository(User)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId: change.userId })
        .getOne();
      if (!user) throw new NotFoundException('User no longer exists');
      return this.applyLockedPhoneIdentity(user, change, transaction);
    };
    return manager
      ? operation(manager)
      : this.dataSource.transaction(operation);
  }

  async applyLockedPhoneIdentity(
    user: User,
    change: Omit<PhoneIdentityChange, 'userId'>,
    manager: EntityManager,
  ): Promise<User> {
    const nextPhone = normalizePhoneIdentity(change);
    const phoneChanged = user.phone !== nextPhone;
    const identityChanged =
      phoneChanged || user.phoneVerified !== change.phoneVerified;

    if (identityChanged || change.forceTokenVersionIncrement) {
      user.tokenVersion += 1;
    }
    user.phone = nextPhone;
    user.phoneVerified = change.phoneVerified;
    return manager.getRepository(User).save(user);
  }
}
