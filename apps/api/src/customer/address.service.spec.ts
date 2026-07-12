import { describe, expect, it } from 'vitest';

import { AddressService } from './address.service.js';

function memoryAddressRepository() {
  const records: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const repository = {
    create: (value: Record<string, unknown>) => value,
    save: async (value: Record<string, unknown>) => {
      if (!value.id) value.id = String(nextId++);
      const index = records.findIndex((record) => record.id === value.id);
      if (index >= 0) records[index] = value;
      else records.push(value);
      return value;
    },
    find: async ({ where }: { where: Record<string, unknown> }) =>
      records.filter((record) =>
        Object.entries(where).every(([key, value]) => record[key] === value),
      ),
    findOneBy: async (where: Record<string, unknown>) =>
      records.find((record) =>
        Object.entries(where).every(([key, value]) => record[key] === value),
      ) ?? null,
    delete: async (where: Record<string, unknown>) => {
      const index = records.findIndex((record) =>
        Object.entries(where).every(([key, value]) => record[key] === value),
      );
      if (index >= 0) records.splice(index, 1);
    },
    update: async (
      where: Record<string, unknown>,
      values: Record<string, unknown>,
    ) => {
      records
        .filter((record) =>
          Object.entries(where).every(([key, value]) => record[key] === value),
        )
        .forEach((record) => Object.assign(record, values));
    },
  };
  return { records, repository };
}

describe('AddressService', () => {
  it('keeps exactly one default address per user', async () => {
    const { repository } = memoryAddressRepository();
    const dataSource = {
      transaction: async <T>(callback: (manager: unknown) => Promise<T>) =>
        callback({ getRepository: () => repository }),
    };
    const service = new AddressService(
      dataSource as never,
      repository as never,
    );
    const userId = 'user-1';

    await service.create(userId, {
      receiverName: 'A',
      phone: '13800000000',
      province: 'Zhejiang',
      city: 'Hangzhou',
      district: 'Xihu',
      detail: 'No. 1',
      isDefault: true,
    });
    const second = await service.create(userId, {
      receiverName: 'B',
      phone: '13900000000',
      province: 'Zhejiang',
      city: 'Hangzhou',
      district: 'Xihu',
      detail: 'No. 2',
      isDefault: true,
    });

    expect(
      (await service.list(userId)).filter((address) => address.isDefault),
    ).toEqual([expect.objectContaining({ id: second.id })]);
  });
});
