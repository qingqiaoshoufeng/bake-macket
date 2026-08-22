import { spawnSync } from 'node:child_process';
import { constants, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPOSE_PROJECT_NAME = 'bake-mall-main';

export function composeProjectName() {
  return COMPOSE_PROJECT_NAME;
}

function ensureDevelopmentEnv() {
  try {
    copyFileSync(
      '.env.development.example',
      '.env.development',
      constants.COPYFILE_EXCL,
    );
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
}

function main() {
  ensureDevelopmentEnv();
  const args = process.argv.slice(2);
  const projectName = composeProjectName();
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      '.env.development',
      '-p',
      projectName,
      '-f',
      'infra/docker-compose.dev.yml',
      ...args,
    ],
    { stdio: 'inherit' },
  );

  process.exit(result.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
