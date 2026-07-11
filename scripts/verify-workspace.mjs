import { existsSync } from 'node:fs';

for (const file of [
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'infra/docker-compose.dev.yml',
]) {
  if (!existsSync(file)) throw new Error(`Missing workspace file: ${file}`);
}

console.log('workspace configuration is complete');
