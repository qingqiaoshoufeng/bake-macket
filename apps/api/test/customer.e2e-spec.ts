import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthModule } from '../src/auth/auth.module.js';
import {
  JWT_ADMIN_AUDIENCE,
  JWT_USER_AUDIENCE,
} from '../src/auth/auth.constants.js';
import { BannerModule } from '../src/banner/banner.module.js';
import { envSchema, type AppConfig } from '../src/config/env.schema.js';
import { AddressService } from '../src/customer/address.service.js';
import { CustomerModule } from '../src/customer/customer.module.js';
import { Address } from '../src/database/entities/address.entity.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { Banner } from '../src/database/entities/banner.entity.js';
import { CartItem } from '../src/database/entities/cart-item.entity.js';
import { Category } from '../src/database/entities/category.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import { Sku } from '../src/database/entities/sku.entity.js';
import { User } from '../src/database/entities/user.entity.js';

function memoryRepository<T extends { id?: string }>() {
  const records: T[] = [];
  let nextId = 1;
  return {
    records,
    create: (value: Partial<T>) => value as T,
    save: async (value: T) => {
      if (!value.id) value.id = String(nextId++);
      const index = records.findIndex((record) => record.id === value.id);
      const timestamped = Object.assign(value, {
        createdAt: value['createdAt' as keyof T] ?? new Date(),
        updatedAt: new Date(),
      });
      if (index >= 0) records[index] = timestamped;
      else records.push(timestamped);
      return timestamped;
    },
    find: async ({
      where,
      order,
    }: {
      where?: Partial<T>;
      order?: Record<string, 'ASC' | 'DESC'>;
    } = {}) =>
      records
        .filter(
          (record) =>
            !where ||
            Object.entries(where).every(
              ([key, value]) => record[key as keyof T] === value,
            ),
        )
        .sort((a, b) => {
          if (!order) return 0;
          for (const [key, direction] of Object.entries(order)) {
            const aValue = a[key as keyof T] as Date | number | boolean;
            const bValue = b[key as keyof T] as Date | number | boolean;
            if (aValue === bValue) continue;
            return (aValue > bValue ? 1 : -1) * (direction === 'ASC' ? 1 : -1);
          }
          return 0;
        }),
    findOneBy: async (where: Partial<T>) =>
      records.find((record) =>
        Object.entries(where).every(
          ([key, value]) => record[key as keyof T] === value,
        ),
      ) ?? null,
    findOneByOrFail: async (where: Partial<T>) => {
      const record = records.find((entry) =>
        Object.entries(where).every(
          ([key, value]) => entry[key as keyof T] === value,
        ),
      );
      if (!record) throw new Error('Entity not found');
      return record;
    },
    findOne: async ({ where }: { where: Partial<T> }) =>
      records.find((record) =>
        Object.entries(where).every(
          ([key, value]) => record[key as keyof T] === value,
        ),
      ) ?? null,
    update: async (where: Partial<T>, values: Partial<T>) => {
      const matching = records.filter((record) =>
        Object.entries(where).every(
          ([key, value]) => record[key as keyof T] === value,
        ),
      );
      matching.forEach((record) => Object.assign(record, values));
      return { affected: matching.length };
    },
    query: async (
      _sql: string,
      [userId, skuId, quantity]: [string, string, number],
    ) => {
      const existing = records.find(
        (record) =>
          record['userId' as keyof T] === userId &&
          record['skuId' as keyof T] === skuId,
      );
      if (existing) {
        existing['quantity' as keyof T] = Math.min(
          99,
          (existing['quantity' as keyof T] as number) + quantity,
        ) as T[keyof T];
      } else {
        records.push({
          id: String(nextId++),
          userId,
          skuId,
          quantity,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as T);
      }
    },
    delete: async (where: string | Partial<T>) => {
      const index = records.findIndex((record) =>
        typeof where === 'string'
          ? record.id === where
          : Object.entries(where).every(
              ([key, value]) => record[key as keyof T] === value,
            ),
      );
      if (index >= 0) records.splice(index, 1);
      return { affected: index >= 0 ? 1 : 0 };
    },
  };
}

describe('Customer domain (e2e)', () => {
  let app: INestApplication;
  let userHeaders: Record<string, string>;
  let adminHeaders: Record<string, string>;
  let productRepo: ReturnType<typeof memoryRepository<Product>>;
  let bannerRepo: ReturnType<typeof memoryRepository<Banner>>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_USER_SECRET = 'customer-user-secret-for-e2e-tests';
    process.env.JWT_ADMIN_SECRET = 'customer-admin-secret-for-e2e-tests';
    process.env.MYSQL_HOST = '127.0.0.1';
    process.env.MYSQL_DATABASE = 'bake_mall_test';
    process.env.MYSQL_USER = 'bake_app_test';

    const userRepo = memoryRepository<User>();
    const adminRepo = memoryRepository<AdminUser>();
    const addressRepo = memoryRepository<Address>();
    const cartRepo = memoryRepository<CartItem>();
    const skuRepo = memoryRepository<Sku>();
    const categoryRepo = memoryRepository<Category>();
    productRepo = memoryRepository<Product>();
    bannerRepo = memoryRepository<Banner>();
    await userRepo.save({
      id: 'user-1',
      phone: '13800000000',
      phoneVerified: true,
      nickname: 'Cake Fan',
      avatarUrl: null,
      wechatOpenid: null,
      wechatUnionid: null,
    } as User);
    await categoryRepo.save({
      id: 'category-1',
      name: 'Cakes',
      isActive: true,
    } as Category);
    await productRepo.save({
      id: 'product-1',
      name: 'Available cake',
      categoryId: 'category-1',
      isActive: true,
      coverImageUrl: null,
      detailHtml: '<p>cake</p>',
    } as Product);
    await skuRepo.save({
      id: 'sku-1',
      productId: 'product-1',
      name: '6 inch',
      attributes: {},
      priceCents: 6800,
      stock: 2,
      imageUrl: null,
      isActive: true,
    } as Sku);

    const dataSource = {
      transaction: async <T>(callback: (manager: unknown) => Promise<T>) =>
        callback({ getRepository: () => addressRepo }),
    };
    const addressService = new AddressService(
      dataSource as never,
      addressRepo as never,
    );
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validate: (raw) => {
            const { value, error } = envSchema.validate(raw ?? process.env, {
              abortEarly: false,
              stripUnknown: true,
            });
            if (error) throw new Error(error.message);
            return { appEnv: value };
          },
        }),
        AuthModule,
        CustomerModule,
        BannerModule,
      ],
    })
      .overrideProvider(AddressService)
      .useValue(addressService)
      .overrideProvider(getRepositoryToken(User))
      .useValue(userRepo)
      .overrideProvider(getRepositoryToken(AdminUser))
      .useValue(adminRepo)
      .overrideProvider(getRepositoryToken(Address))
      .useValue(addressRepo)
      .overrideProvider(getRepositoryToken(CartItem))
      .useValue(cartRepo)
      .overrideProvider(getRepositoryToken(Sku))
      .useValue(skuRepo)
      .overrideProvider(getRepositoryToken(Product))
      .useValue(productRepo)
      .overrideProvider(getRepositoryToken(Category))
      .useValue(categoryRepo)
      .overrideProvider(getRepositoryToken(Banner))
      .useValue(bannerRepo)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    const jwt = app.get(JwtService);
    const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
    userHeaders = {
      Authorization: `Bearer ${await jwt.signAsync(
        { sub: 'user-1', phone: '13800000000', aud: JWT_USER_AUDIENCE },
        { secret: config.get('appEnv', { infer: true }).JWT_USER_SECRET },
      )}`,
    };
    adminHeaders = {
      Authorization: `Bearer ${await jwt.signAsync(
        {
          sub: 'admin-1',
          email: 'admin@example.test',
          aud: JWT_ADMIN_AUDIENCE,
        },
        { secret: config.get('appEnv', { infer: true }).JWT_ADMIN_SECRET },
      )}`,
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps only the second default address, merges repeated SKU additions, and filters disabled or invalid banners', async () => {
    const firstAddress = {
      receiverName: 'A',
      phone: '13800000000',
      province: 'Zhejiang',
      city: 'Hangzhou',
      district: 'Xihu',
      detail: 'No. 1',
      isDefault: true,
    };
    await request(app.getHttpServer())
      .post('/api/v1/me/addresses')
      .set(userHeaders)
      .send(firstAddress)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/api/v1/me/addresses')
      .set(userHeaders)
      .send({ ...firstAddress, receiverName: 'B', detail: 'No. 2' })
      .expect(201);
    const addresses = await request(app.getHttpServer())
      .get('/api/v1/me/addresses')
      .set(userHeaders)
      .expect(200);
    expect(
      addresses.body.filter(
        (address: { isDefault: boolean }) => address.isDefault,
      ),
    ).toEqual([expect.objectContaining({ id: second.body.id })]);

    await request(app.getHttpServer())
      .post('/api/v1/me/cart/items')
      .set(userHeaders)
      .send({ skuId: 'sku-1', quantity: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/me/cart/items')
      .set(userHeaders)
      .send({ skuId: 'sku-1', quantity: 2 })
      .expect(201);
    const cart = await request(app.getHttpServer())
      .get('/api/v1/me/cart/items')
      .set(userHeaders)
      .expect(200);
    expect(cart.body).toEqual([
      expect.objectContaining({
        quantity: 3,
        available: true,
        sku: expect.objectContaining({ priceCents: 6800, stock: 2 }),
      }),
    ]);

    const validBanner = await request(app.getHttpServer())
      .post('/api/v1/admin/banners')
      .set(adminHeaders)
      .send({
        imageUrl: 'https://cdn.example.test/valid.jpg',
        targetType: 'PRODUCT',
        targetId: 'product-1',
      })
      .expect(201);
    await bannerRepo.save({
      imageUrl: 'https://cdn.example.test/disabled.jpg',
      targetType: 'NONE',
      targetId: null,
      sortOrder: 0,
      isActive: false,
    } as Banner);
    await bannerRepo.save({
      imageUrl: 'https://cdn.example.test/invalid.jpg',
      targetType: 'PRODUCT',
      targetId: 'missing-product',
      sortOrder: 0,
      isActive: true,
    } as Banner);
    const banners = await request(app.getHttpServer())
      .get('/api/v1/public/banners')
      .expect(200);
    expect(banners.body).toEqual([
      expect.objectContaining({
        id: validBanner.body.id,
        targetId: 'product-1',
      }),
    ]);
  });
});
