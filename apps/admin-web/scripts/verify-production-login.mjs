import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const TEST_CREDENTIALS = {
  VITE_ADMIN_EMAIL: 'admin@example.com',
  VITE_ADMIN_PASSWORD: 'admin-password',
};
const DIST_DIRECTORY = fileURLToPath(new URL('../dist/', import.meta.url));
const TEXT_ASSET_EXTENSIONS = new Set(['.css', '.html', '.js', '.map']);

function collectTextAssets(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTextAssets(path);
    return TEXT_ASSET_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

const build = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, ...TEST_CREDENTIALS, NODE_ENV: 'production' },
  stdio: 'inherit',
});

if (build.status !== 0) process.exit(build.status ?? 1);

const leakedCredentials = collectTextAssets(DIST_DIRECTORY).flatMap((path) => {
  const contents = readFileSync(path, 'utf8');
  return Object.values(TEST_CREDENTIALS)
    .filter((credential) => contents.includes(credential))
    .map((credential) => ({ credential, path }));
});

if (leakedCredentials.length > 0) {
  leakedCredentials.forEach(({ credential, path }) => {
    console.error(`Production bundle contains ${credential} in ${path}`);
  });
  process.exit(1);
}

console.log('Production bundle excludes injected admin credentials.');
