import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from './auth.module.js';

describe('AuthModule', () => {
  it('re-exports the audit dependency required by permission guards', () => {
    const exportedModules = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      AuthModule,
    ) as unknown[];

    expect(exportedModules).toContain(AuditModule);
  });
});
