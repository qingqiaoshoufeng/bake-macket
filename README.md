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
# Optional: pnpm services:* and pnpm dev create this file when it is missing.
cp .env.development.example .env.development
pnpm dev
pnpm build
```

Local defaults are API `43015`, H5 `43173`, Admin `43174`, MySQL `43306`, MinIO API `43900`, and MinIO Console `43901`, all on `127.0.0.1`. H5/Admin dev and preview accept `12297oy2ga916.vicp.fun`; change `allowedHosts` in both Vite configs if the tunnel hostname changes. Use `.env.production.example` as the API deployment contract; production frontends expect the deployment layer to route same-origin `/api/v1` requests to the API.

## 运行手册

- [本地开发](docs/runbook/local-development.md)：启动、端口、开发账号、MinIO、小程序开发者工具与 E2E。
- [生产部署](docs/runbook/deployment.md)：生产变量、MySQL 迁移、API Docker、Nginx 路由、COS 与 TLS。
- [微信小程序 H5 容器配置](docs/runbook/wechat-miniapp-setup.md)：受控 URL、域名配置、桥接协议和真机验收。

## TypeScript configuration

Shared packages should extend `tsconfig.base.json`, which permits build output and does not impose browser globals. Vite browser applications should extend `tsconfig.browser.json`, which supplies DOM types and uses Vite-compatible module resolution.

## Local services

Start MySQL and MinIO for local development. This command also initializes the `bake-mall` S3 bucket:

```bash
pnpm services:up
```

These service commands always reuse the single Docker Compose project `bake-mall-main`. Every branch and worktree shares this one MySQL/MinIO resource environment; do not start a second stack or assign branch-specific service ports. All published service ports bind to `127.0.0.1` and are local-only.

| Service       | Address                  | Notes                                                     |
| ------------- | ------------------------ | --------------------------------------------------------- |
| MySQL 8.4     | `127.0.0.1:43306`        | Database: `bake_mall`; local application user: `bake_app` |
| MinIO S3 API  | `http://127.0.0.1:43900` | Local-only object-storage endpoint                        |
| MinIO Console | `http://127.0.0.1:43901` | Local-only administrative console                         |

Check container status with:

```bash
pnpm services:ps
```

Local credentials and host ports come from the ignored `.env.development`, created exclusively from `.env.development.example` when missing. Do not reuse these values outside development or commit real credentials. MySQL and MinIO data use named Docker volumes and persist across `pnpm services:down`.

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
