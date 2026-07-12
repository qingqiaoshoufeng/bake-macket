import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthModule } from '../src/auth/auth.module.js';
import { JWT_ADMIN_AUDIENCE } from '../src/auth/auth.constants.js';
import { CatalogModule } from '../src/catalog/catalog.module.js';
import { envSchema, type AppConfig } from '../src/config/env.schema.js';
import { Category } from '../src/database/entities/category.entity.js';
import { ProductImage } from '../src/database/entities/product-image.entity.js';
import { Product } from '../src/database/entities/product.entity.js';
import { Sku } from '../src/database/entities/sku.entity.js';
import { AdminUser } from '../src/database/entities/admin-user.entity.js';
import { User } from '../src/database/entities/user.entity.js';

function memoryRepository<T extends { id?: string }>() {
  const records: T[] = [];
  let nextId = 1;
  return {
    records,
    create: (value: Partial<T>) => value as T,
    save: async (value: T) => {
      if (!value.id) value.id = String(nextId++);
      const existing = records.findIndex((record) => record.id === value.id);
      const timestamped = Object.assign(value, {
        createdAt: value['createdAt' as keyof T] ?? new Date(),
        updatedAt: new Date(),
      });
      if (existing >= 0) records[existing] = timestamped;
      else records.push(timestamped);
      return timestamped;
    },
    find: async ({
      where,
      order,
    }: { where?: Partial<T>; order?: Record<string, 'ASC' | 'DESC'> } = {}) =>
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
            const aValue = a[key as keyof T] as Date | number;
            const bValue = b[key as keyof T] as Date | number;
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
    findOne: async ({ where }: { where: Partial<T> }) =>
      records.find((record) =>
        Object.entries(where).every(
          ([key, value]) => record[key as keyof T] === value,
        ),
      ) ?? null,
    delete: async (where: string | Partial<T>) => {
      const index = records.findIndex((record) =>
        typeof where === 'string'
          ? record.id === where
          : Object.entries(where).every(
              ([key, value]) => record[key as keyof T] === value,
            ),
      );
      if (index >= 0) records.splice(index, 1);
    },
  };
}

describe('Catalog (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let categoryRepo: ReturnType<typeof memoryRepository<Category>>;
  let productRepo: ReturnType<typeof memoryRepository<Product>>;
  let productsWithCategories: {
    find: (options?: {
      relations?: { category?: boolean };
    }) => Promise<Product[]>;
    findOne: (options: {
      where: Partial<Product>;
      relations?: { category?: boolean };
    }) => Promise<Product | null>;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_USER_SECRET = 'catalog-user-secret-for-e2e-tests';
    process.env.JWT_ADMIN_SECRET = 'catalog-admin-secret-for-e2e-tests';
    process.env.MYSQL_HOST = '127.0.0.1';
    process.env.MYSQL_DATABASE = 'bake_mall_test';
    process.env.MYSQL_USER = 'bake_app_test';

    categoryRepo = memoryRepository<Category>();
    productRepo = memoryRepository<Product>();
    const skuRepo = memoryRepository<Sku>();
    const imageRepo = memoryRepository<ProductImage>();
    productsWithCategories = {
      ...productRepo,
      find: async (options?: { relations?: { category?: boolean } }) => {
        const products = await productRepo.find();
        return options?.relations?.category
          ? products.map((product) =>
              Object.assign(product, {
                category: categoryRepo.records.find(
                  (category) => category.id === product.categoryId,
                ),
              }),
            )
          : products;
      },
      findOne: async ({
        where,
        relations,
      }: {
        where: Partial<Product>;
        relations?: { category?: boolean };
      }) => {
        const product = await productRepo.findOne({ where });
        if (!product || !relations?.category) return product;
        return Object.assign(product, {
          category: categoryRepo.records.find(
            (category) => category.id === product.categoryId,
          ),
        });
      },
    };

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
        CatalogModule,
      ],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue(memoryRepository<User>())
      .overrideProvider(getRepositoryToken(AdminUser))
      .useValue(memoryRepository<AdminUser>())
      .overrideProvider(getRepositoryToken(Category))
      .useValue(categoryRepo)
      .overrideProvider(getRepositoryToken(Product))
      .useValue(productsWithCategories)
      .overrideProvider(getRepositoryToken(Sku))
      .useValue(skuRepo)
      .overrideProvider(getRepositoryToken(ProductImage))
      .useValue(imageRepo)
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
    adminToken = await jwt.signAsync(
      { sub: 'admin-1', email: 'admin@example.test', aud: JWT_ADMIN_AUDIENCE },
      { secret: config.get('appEnv', { infer: true }).JWT_ADMIN_SECRET },
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets an admin create catalog records and hides disabled product content publicly', async () => {
    const admin = { Authorization: `Bearer ${adminToken}` };
    const category = (
      await request(app.getHttpServer())
        .post('/api/v1/admin/categories')
        .set(admin)
        .send({ name: 'Cakes', sortOrder: 2 })
        .expect(201)
    ).body;
    const active = (
      await request(app.getHttpServer())
        .post('/api/v1/admin/products')
        .set(admin)
        .send({
          name: 'Safe cake',
          categoryId: category.id,
          detailHtml:
            '<p onclick="alert(1)">safe</p><script>alert(1)</script><img src="https://evil.test/a.png">',
        })
        .expect(201)
    ).body;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/products/${active.id}/skus`)
      .set(admin)
      .send({ name: '6 inch', priceCents: 6800, stock: 2 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/products/${active.id}/skus`)
      .set(admin)
      .send({ name: '8 inch', priceCents: 8800, stock: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/admin/products')
      .set(admin)
      .send({
        name: 'Hidden cake',
        categoryId: category.id,
        detailHtml: '<p>hidden</p>',
        isActive: false,
      })
      .expect(201);

    const products = await request(app.getHttpServer())
      .get('/api/v1/public/products')
      .expect(200);
    expect(products.body).toHaveLength(1);
    expect(products.body[0]).toMatchObject({
      id: active.id,
      detailHtml: '<p>safe</p>',
    });
    expect(products.body[0].skus).toHaveLength(2);
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/public/products/${active.id}`)
      .expect(200);
    expect(detail.body.detailHtml).toBe('<p>safe</p>');
    expect(detail.body.skus).toHaveLength(2);
  });
});
