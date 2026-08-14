import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AdminLoginDto } from './admin-login.dto.js';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

const validate = (value: unknown) =>
  pipe.transform(value, {
    type: 'body',
    metatype: AdminLoginDto,
  });

describe('AdminLoginDto', () => {
  it.each([
    {
      kind: 'SUPER_ADMIN',
      email: 'admin@example.com',
      password: 'legacy-pass',
    },
    { kind: 'OPERATOR', phone: '13800000000', password: '123456' },
  ])('接受可辨识分支 %#', async (value) => {
    await expect(validate(value)).resolves.toMatchObject(value);
  });

  it.each([
    {
      kind: 'SUPER_ADMIN',
      email: 'admin@example.com',
      phone: '13800000000',
      password: 'legacy-pass',
    },
    {
      kind: 'OPERATOR',
      email: 'admin@example.com',
      phone: '13800000000',
      password: '123456',
    },
    {
      kind: 'SUPER_ADMIN',
      email: 'admin@example.com',
      password: 'x',
      extra: true,
    },
    { email: 'admin@example.com', password: 'legacy-pass' },
  ])('拒绝混合、额外字段或缺少 kind %#', async (value) => {
    await expect(validate(value)).rejects.toMatchObject({ status: 400 });
  });
});
