# 本地开发

本文档是当前工作树的可重复本地启动路径。项目使用静态 SPA，不使用 SSR；API、H5 与后台都仅监听 `127.0.0.1`。

## 前置条件

- Node.js `>=22.13`
- Corepack 与 pnpm `9.15.4`
- Docker Desktop（Docker Compose v2）

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm verify:workspace
```

## 启动

根目录的 `.env.development` 被 Git 忽略。首次执行 `pnpm dev` 或 `pnpm services:up` 时，会由 `.env.development.example` 自动创建；也可显式复制：

```bash
cp .env.development.example .env.development
pnpm dev
```

`pnpm dev` 会启动或复用全项目唯一的 `bake-mall-main` Compose 项目、构建共享契约、执行开发库 migration，再启动 API/H5/Admin。所有分支与工作树共享这一套资源和服务环境，不得另起 MySQL、MinIO 或分支专属端口。

| 服务          | 地址                            | 说明                          |
| ------------- | ------------------------------- | ----------------------------- |
| API           | `http://127.0.0.1:43015/api/v1` | 健康检查：`/health`           |
| H5 商城       | `http://127.0.0.1:43173`        | Vite SPA                      |
| 商家后台      | `http://127.0.0.1:43174`        | Vite SPA                      |
| MySQL 8.4     | `127.0.0.1:43306`               | `bake_mall` 开发数据库        |
| MinIO S3 API  | `http://127.0.0.1:43900`        | 已自动创建 `bake-mall` bucket |
| MinIO Console | `http://127.0.0.1:43901`        | 本地对象存储控制台            |

API 内部通过 `OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:43900` 读取唯一 MinIO；面向浏览器/真机的预签名上传使用 `OBJECT_STORAGE_CLIENT_ENDPOINT`。开发 tunnel 必须把 `/bake-mall`（bucket 根 POST）和 `/bake-mall/`（对象 GET）都反代到同一 MinIO。

默认开发登录：顾客 `13800000000 / 123456`；管理员 `admin-local@example.com / admin-password`。真实本地凭据只留在被忽略的 `.env.development`。

## 服务管理

```bash
pnpm services:ps
pnpm services:down
```

Compose 项目名固定为 `bake-mall-main`。任何分支或工作树都必须复用 `43306/43900/43901` 这一套 MySQL/MinIO，不得修改为分支专属端口，也不得启动第二套容器。若端口已占用，应先确认并复用现有 `bake-mall-main`，而不是绕开冲突。

## 小程序开发者工具 URL

小程序运行时不读取 shell 环境变量。生成受控 H5 URL 后再导入 `apps/miniapp-shell`：

```bash
MINIAPP_H5_URL=https://mall.example.com/ pnpm --filter @bake-mall/miniapp-shell build
```

PowerShell：

```powershell
$env:MINIAPP_H5_URL = 'https://mall.example.com/'
pnpm --filter @bake-mall/miniapp-shell build
```

正式 `web-view` URL 必须是已备案并配置为微信业务域名的 HTTPS 根路径。详见 [微信小程序 H5 容器配置](./wechat-miniapp-setup.md)。

## E2E 验收（默认隔离）

安装 Chromium 后直接运行：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

默认 runner 会：

1. 启动或复用全项目唯一的 `bake-mall-main` MySQL/MinIO Compose 项目并保留基础设施；
2. 创建随机临时 MySQL schema 和临时最小权限用户；
3. 选择空闲 API/H5/Admin 端口，构建 contracts，并只对临时 schema 执行 migration；
4. 启动三个 Playwright webServer 并运行真实 Chromium 流程；
5. 无论成功或失败，都删除临时 schema 和用户；不会执行 `services:down`，也不会创建或清理第二套工作树容器。

复用外部服务仅在明确设置 `E2E_USE_EXISTING_SERVERS=1` 时启用。`DATABASE_URL` 必须指向可丢弃数据库，并同时给出三个根 URL（不支持子路径）或三个端口。

Bash：

```bash
E2E_USE_EXISTING_SERVERS=1 \
DATABASE_URL='mysql://user:password@127.0.0.1:43306/disposable_e2e' \
H5_URL='http://127.0.0.1:43173' \
ADMIN_URL='http://127.0.0.1:43174' \
API_URL='http://127.0.0.1:43015' \
pnpm test:e2e
```

PowerShell：

```powershell
$env:E2E_USE_EXISTING_SERVERS = '1'
$env:DATABASE_URL = 'mysql://user:password@127.0.0.1:43306/disposable_e2e'
$env:H5_URL = 'http://127.0.0.1:43173'
$env:ADMIN_URL = 'http://127.0.0.1:43174'
$env:API_URL = 'http://127.0.0.1:43015'
pnpm test:e2e
```

外部服务模式不会代管或清理该数据库，使用者必须自行保证它可丢弃且与其他工作树隔离。
