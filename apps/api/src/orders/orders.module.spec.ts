import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { expect, it } from 'vitest';

import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { OrdersModule } from './orders.module.js';

it('imports the shared idempotency module for OrdersService', () => {
  const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, OrdersModule) as
    unknown[] | undefined;

  expect(imports).toContain(IdempotencyModule);
});
