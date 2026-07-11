import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function composeProjectName(branch) {
  const sanitized =
    branch
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '') || 'detached';

  return `bake-mall-${sanitized}`;
}

function currentBranch() {
  try {
    return (
      execFileSync('git', ['branch', '--show-current'], {
        encoding: 'utf8',
      }).trim() || 'detached'
    );
  } catch {
    return 'detached';
  }
}

function main() {
  const args = process.argv.slice(2);
  const projectName = composeProjectName(currentBranch());
  const result = spawnSync(
    'docker',
    [
      'compose',
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
