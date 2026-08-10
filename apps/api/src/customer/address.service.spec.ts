import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { Address } from '../database/entities/address.entity.js';
import { User } from '../database/entities/user.entity.js';
import { UserIdentityService } from '../users/user-identity.service.js';
import { AddressService } from './address.service.js';

const addressDto = {
  receiverName: 'A',
  phone: '13800000000',
  province: 'Zhejiang',
  city: 'Hangzhou',
  district: 'Xihu',
  detail: 'No. 1',
  isDefault: true,
};

function memoryAddressRepository() {
  const records: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const repository = {
    create: vi.fn((value: Record<string, unknown>) => value),
    save: vi.fn(async (value: Record<string, unknown>) => {
      if (!value.id) value.id = String(nextId++);
      const index = records.findIndex((record) => record.id === value.id);
      if (index >= 0) records[index] = { ...value };
      else records.push({ ...value });
      return value;
    }),
    find: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      records.filter((record) =>
        Object.entries(where).every(([key, value]) => record[key] === value),
      ),
    ),
    findOneBy: vi.fn(
      async (where: Record<string, unknown>) =>
        records.find((record) =>
          Object.entries(where).every(([key, value]) => record[key] === value),
        ) ?? null,
    ),
    delete: vi.fn(async (where: Record<string, unknown>) => {
      const index = records.findIndex((record) =>
        Object.entries(where).every(([key, value]) => record[key] === value),
      );
      if (index >= 0) records.splice(index, 1);
      return { affected: index >= 0 ? 1 : 0 };
    }),
    update: vi.fn(
      async (
        where: Record<string, unknown>,
        values: Record<string, unknown>,
      ) => {
        const matching = records.filter((record) =>
          Object.entries(where).every(([key, value]) => record[key] === value),
        );
        matching.forEach((record) => Object.assign(record, values));
        return { affected: matching.length };
      },
    ),
  };
  return { records, repository };
}

type UserState = Pick<User, 'id' | 'isActive' | 'mergedIntoUserId'> | null;

const buildHarness = (
  user: UserState = {
    id: 'user-1',
    isActive: true,
    mergedIntoUserId: null,
  },
) => {
  const { records, repository: addresses } = memoryAddressRepository();
  const setLock = vi.fn().mockReturnThis();
  const getOne = vi.fn().mockResolvedValue(user);
  const users = {
    createQueryBuilder: vi.fn(() => ({
      setLock,
      where: vi.fn().mockReturnThis(),
      getOne,
    })),
  };
  const manager = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === User) return users;
      if (entity === Address) return addresses;
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
  const service = Reflect.construct(AddressService, [
    dataSource,
    addresses,
  ]) as AddressService;
  Object.assign(service, { identities });
  return { addresses, dataSource, manager, records, service, setLock };
};

const seedAddress = (records: Array<Record<string, unknown>>) => {
  records.push({
    id: 'address-1',
    userId: 'user-1',
    recipient: 'A',
    phone: '13800000000',
    province: 'Zhejiang',
    city: 'Hangzhou',
    district: 'Xihu',
    detail: 'No. 1',
    isDefault: false,
  });
};

const writeCases = [
  {
    name: 'create',
    run: (service: AddressService) => service.create('user-1', addressDto),
  },
  {
    name: 'update',
    run: (service: AddressService) =>
      service.update('user-1', 'address-1', { receiverName: 'B' }),
  },
  {
    name: 'setDefault',
    run: (service: AddressService) => service.setDefault('user-1', 'address-1'),
  },
  {
    name: 'remove',
    run: (service: AddressService) => service.remove('user-1', 'address-1'),
  },
] as const;

describe('AddressService', () => {
  it('keeps exactly one default address per user', async () => {
    const { service } = buildHarness();

    await service.create('user-1', addressDto);
    const second = await service.create('user-1', {
      ...addressDto,
      receiverName: 'B',
      phone: '13900000000',
      detail: 'No. 2',
    });

    expect(
      (await service.list('user-1')).filter((address) => address.isDefault),
    ).toEqual([expect.objectContaining({ id: second.id })]);
  });

  it.each(writeCases)(
    '$name locks User before the address write',
    async ({ run }) => {
      const { records, service, setLock } = buildHarness();
      seedAddress(records);

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
    '$name rejects a $state User without writing the address repository',
    async ({ run, user }) => {
      const { addresses, records, service, setLock } = buildHarness(user);
      seedAddress(records);

      await expect(run(service)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof UnauthorizedException && error.getStatus() === 401,
      );

      expect(setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(addresses.save).not.toHaveBeenCalled();
      expect(addresses.update).not.toHaveBeenCalled();
      expect(addresses.delete).not.toHaveBeenCalled();
    },
  );
});
