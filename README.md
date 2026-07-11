# Bake Mall

Bake Mall is a pnpm workspace for the customer H5 storefront, merchant admin, miniapp shell, API, and shared contracts. The web applications will be Vite client-side SPAs; this repository does not use SSR.

## Prerequisites

- Node.js 22.13 or newer
- pnpm 9.15 or newer
- Docker Desktop with Docker Compose v2

Enable the pinned pnpm release with Corepack if necessary:

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

## Install and verify

```bash
pnpm install
pnpm verify:workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

Workspace application commands are available at the root:

```bash
pnpm dev
pnpm build
```

## TypeScript configuration

Shared packages should extend `tsconfig.base.json`, which permits build output and does not impose browser globals. Vite browser applications should extend `tsconfig.browser.json`, which supplies DOM types and uses Vite-compatible module resolution.

## Local services

Start MySQL and MinIO for local development:

```bash
pnpm services:up
```

These service commands derive an isolated Docker Compose project name from the current Git branch, preventing local service state collisions between worktrees.

| Service       | Address                 | Notes                                                     |
| ------------- | ----------------------- | --------------------------------------------------------- |
| MySQL 8.4     | `localhost:3306`        | Database: `bake_mall`; local application user: `bake_app` |
| MinIO S3 API  | `http://localhost:9000` | Local-only object-storage endpoint                        |
| MinIO Console | `http://localhost:9001` | Local-only administrative console                         |

Check container status with:

```bash
pnpm services:ps
```

The credentials in `infra/docker-compose.dev.yml` are deliberately local development defaults only. Copy `.env.example` to `.env` to authenticate to the local MySQL and MinIO services; do not reuse these values outside local development or commit real credentials. MySQL and MinIO data are stored in named Docker volumes so they persist across `pnpm services:down`.

Stop the local services with:

```bash
pnpm services:down
```

## Repository layout

```text
apps/       Application workspaces
packages/   Shared workspace packages
infra/      Local and deployment infrastructure
scripts/    Repository verification scripts
docs/       Specifications and project documentation
```
