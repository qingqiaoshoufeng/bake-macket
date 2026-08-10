import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { name: string; scripts: Record<string, string> };
const manifest = JSON.parse(
  readFileSync(new URL('../../src/manifest.json', import.meta.url), 'utf8'),
) as {
  'app-plus': { distribute: { android: { schemes?: string } } };
};
const vitestConfig = readFileSync(
  new URL('../../vitest.config.ts', import.meta.url),
  'utf8',
);
const hardwareVitestConfig = readFileSync(
  new URL('../../vitest.hardware.config.ts', import.meta.url),
  'utf8',
);
const gitignore = readFileSync(
  new URL('../../../../.gitignore', import.meta.url),
  'utf8',
);

describe('merchant terminal workspace', () => {
  it('keeps Android tooling out of the normal build gate', () => {
    expect(packageJson.name).toBe('@bake-mall/merchant-terminal');
    expect(packageJson.scripts.build).toBe('pnpm build:check');
    expect(packageJson.scripts['build:app-resources']).toBe(
      'uni build -p app-android',
    );
    expect(packageJson.scripts['package:android']).toBe(
      'node scripts/package-android.mjs',
    );
    expect(packageJson.scripts.build).not.toContain('app');
  });

  it('registers the restricted Android smoke URL scheme', () => {
    expect(manifest['app-plus'].distribute.android.schemes).toBe(
      'bakemall-terminal',
    );
  });

  it('ignores the local HBuilderX signing configuration', () => {
    expect(gitignore).toContain('apps/merchant-terminal/pack.local.json');
  });

  it('keeps the hardware fixture gate out of host-safe default tests', () => {
    expect(vitestConfig).toContain('xinye-xp58iih.verified.spec.ts');
    expect(packageJson.scripts['test:hardware']).toContain(
      'vitest.hardware.config.ts',
    );
    expect(hardwareVitestConfig).toContain('xinye-xp58iih.verified.spec.ts');
  });
});
