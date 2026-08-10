import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AdminUser } from '../database/entities/admin-user.entity.js';
import { User } from '../database/entities/user.entity.js';
import {
  UserIdentityService,
  normalizePhone,
} from './user-identity.service.js';

const buildManager = (user: Partial<User>, operator?: Partial<AdminUser>) => {
  const userSave = vi.fn(async (value: User) => value);
  const adminSave = vi.fn(async (value: AdminUser) => value);
  const queryBuilder = (row: unknown) => ({
    setLock: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    getOne: vi.fn().mockResolvedValue(row),
    getMany: vi.fn().mockResolvedValue(row ? [row] : []),
  });
  const manager = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === User) {
        return {
          createQueryBuilder: vi.fn(() => queryBuilder(user)),
          save: userSave,
        };
      }
      if (entity === AdminUser) {
        return {
          createQueryBuilder: vi.fn(() => queryBuilder(operator)),
          save: adminSave,
        };
      }
      throw new Error('unexpected entity');
    }),
  };
  return { manager, userSave, adminSave };
};

describe('normalizePhone', () => {
  it('复用既有 6-20 位数字及可选加号规则并去除首尾空白', () => {
    expect(normalizePhone('  +8613800000000 ')).toBe('+8613800000000');
    expect(() => normalizePhone('138-0000-0000')).toThrow(BadRequestException);
  });
});

describe('UserIdentityService', () => {
  it('在身份写边界内创建未验证 placeholder', async () => {
    const create = vi.fn((value: Partial<User>) => value as User);
    const save = vi.fn(async (value: User) => ({
      ...value,
      id: '11',
      createdAt: new Date('2026-08-05T00:00:00.000Z'),
    }));
    const manager = {
      getRepository: vi.fn(() => ({ create, save })),
    };
    const service = new UserIdentityService({ transaction: vi.fn() } as never);

    const result = await service.createPhonePlaceholder(
      '13800000000',
      manager as never,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '13800000000',
        phoneVerified: false,
        tokenVersion: 1,
      }),
    );
    expect(result).toMatchObject({ id: '11', phoneVerified: false });
  });

  it('按 user → linked admin 的固定顺序加锁并在锁后应用变更', async () => {
    const calls: string[] = [];
    const user = {
      id: '7',
      phone: '13700000000',
      phoneVerified: true,
      tokenVersion: 1,
    };
    const operator = { id: '9', linkedUserId: '7', tokenVersion: 2 };
    const manager = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === User) {
          return {
            createQueryBuilder: vi.fn(() => ({
              setLock: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              getOne: vi.fn(async () => {
                calls.push('user-lock');
                return user;
              }),
            })),
            save: vi.fn(async (value: User) => {
              calls.push('user-save');
              return value;
            }),
          };
        }
        return {
          createQueryBuilder: vi.fn(() => ({
            setLock: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getOne: vi.fn(async () => {
              calls.push('admin-lock');
              return operator;
            }),
          })),
          save: vi.fn(async (value: AdminUser) => {
            calls.push('admin-save');
            return value;
          }),
        };
      }),
    };
    const service = new UserIdentityService({ transaction: vi.fn() } as never);

    await service.setVerifiedPhone('7', '13800000000', manager as never);

    expect(calls).toEqual([
      'user-lock',
      'admin-lock',
      'admin-save',
      'user-save',
    ]);
  });
  it('普通同记录验证成功递增 User tokenVersion，但 false→true 不递增 OPERATOR', async () => {
    const user = {
      id: '7',
      phone: '13800000000',
      phoneVerified: false,
      tokenVersion: 4,
    };
    const operator = { id: '9', linkedUserId: '7', tokenVersion: 2 };
    const { manager, userSave, adminSave } = buildManager(user, operator);
    const service = new UserIdentityService({ transaction: vi.fn() } as never);

    await service.setVerifiedPhone('7', '13800000000', manager as never);

    expect(userSave).toHaveBeenCalledWith(
      expect.objectContaining({ phoneVerified: true, tokenVersion: 5 }),
    );
    expect(adminSave).not.toHaveBeenCalled();
  });

  it('手机号变化时在同一 manager 内递增关联 OPERATOR tokenVersion', async () => {
    const user = {
      id: '7',
      phone: '13700000000',
      phoneVerified: true,
      tokenVersion: 1,
    };
    const operator = { id: '9', linkedUserId: '7', tokenVersion: 3 };
    const { manager, adminSave } = buildManager(user, operator);
    const service = new UserIdentityService({ transaction: vi.fn() } as never);

    await service.setVerifiedPhone('7', '13800000000', manager as never);

    expect(adminSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: '9', tokenVersion: 4 }),
    );
  });

  it('phoneVerified true→false 时递增双方 tokenVersion，且无 OPERATOR 不报错', async () => {
    const user = {
      id: '7',
      phone: '13800000000',
      phoneVerified: true,
      tokenVersion: 8,
    };
    const { manager, userSave } = buildManager(user);
    const service = new UserIdentityService({ transaction: vi.fn() } as never);

    await service.setPhoneIdentity(
      { userId: '7', phone: '13800000000', phoneVerified: false },
      manager as never,
    );

    expect(userSave).toHaveBeenCalledWith(
      expect.objectContaining({ phoneVerified: false, tokenVersion: 9 }),
    );
  });

  it('setPhoneIdentity 拒绝 phoneVerified=true 且 phone=null，不保存 User 或操作 OPERATOR', async () => {
    const user = {
      id: '7',
      phone: null,
      phoneVerified: false,
      tokenVersion: 1,
    };
    const { manager, userSave, adminSave } = buildManager(user);
    const service = new UserIdentityService({ transaction: vi.fn() } as never);

    await expect(
      service.setPhoneIdentity(
        { userId: '7', phone: null, phoneVerified: true },
        manager as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(userSave).not.toHaveBeenCalled();
    expect(adminSave).not.toHaveBeenCalled();
    expect(manager.getRepository).not.toHaveBeenCalledWith(AdminUser);
  });

  it.each([null, '138-0000-0000'])(
    'applyLockedPhoneIdentity 防止内部误写 verified=true/phone=%s',
    async (phone) => {
      const user = {
        id: '7',
        phone: '13800000000',
        phoneVerified: true,
        tokenVersion: 1,
      };
      const { manager, userSave, adminSave } = buildManager(user);
      const service = new UserIdentityService({
        transaction: vi.fn(),
      } as never);

      await expect(
        service.applyLockedPhoneIdentity(
          user as User,
          { phone, phoneVerified: true },
          manager as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(userSave).not.toHaveBeenCalled();
      expect(adminSave).not.toHaveBeenCalled();
      expect(manager.getRepository).not.toHaveBeenCalled();
    },
  );
});
