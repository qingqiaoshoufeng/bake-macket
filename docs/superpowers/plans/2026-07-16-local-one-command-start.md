# 本地一键启动实施计划

> **供代理执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务实施。步骤使用复选框跟踪。

**目标：** 让开发者在仓库根目录执行一次 `pnpm dev`，即可完成基础设施启动、数据库迁移以及 API、H5、Admin 三个应用的前台并行运行。

**架构：** 根 `dev` script 使用 `&&` 串行执行短生命周期准备步骤，再通过 pnpm workspace 的 `--parallel --stream` 运行三个长期 `dev` 进程。API 从被忽略的应用级 `.env` 读取本地配置；Vite 使用固定严格端口；Nest 增量缓存放入 `dist`，随输出目录一起清理。

**技术栈：** pnpm 9.15.4 workspace、Node.js >=22.13、NestJS 11、Vite、Docker Compose、TypeORM。

## 全局约束

- 规格、计划、任务简报和报告使用中文；代码、命令、路径、API 和标识符保留英文。
- 不引入 `concurrently`、Turbo、Nx 或新的运行时/开发依赖。
- 不修改生产部署流程。
- 本地密码只写入被 Git 忽略的环境文件。
- 不提交 Git，除非用户明确要求。
- 保留现有未提交改动，不修改与一键启动无关的分类管理文件。
- 顶层任务保持少量且用户可见；每完成一个顶层任务播报 `进度 N/M`。

---

### 任务 1：锁定一键启动配置契约

**文件：**

- 新建：`scripts/dev-config.test.mjs`
- 修改：`package.json`
- 修改：`apps/api/package.json`
- 修改：`apps/api/tsconfig.build.json`
- 修改：`apps/h5-store/vite.config.ts`
- 修改：`apps/admin-web/vite.config.ts`

**接口：**

- 根 `pnpm dev` 依次执行 `services:up`、API migration、workspace 并行 `dev`。
- API 暴露 `dev` script。
- API build info 位于 `dist/tsconfig.build.tsbuildinfo`。
- H5/Admin 的 Vite `strictPort` 为 `true`。

- [ ] **步骤 1：新增失败的配置测试**

创建 `scripts/dev-config.test.mjs`，读取 JSON 与 Vite 配置源码并断言：

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const rootPackage = readJson('package.json');
const apiPackage = readJson('apps/api/package.json');
const apiBuildConfig = readJson('apps/api/tsconfig.build.json');
const h5ViteConfig = readFileSync('apps/h5-store/vite.config.ts', 'utf8');
const adminViteConfig = readFileSync('apps/admin-web/vite.config.ts', 'utf8');

assert.equal(
  rootPackage.scripts.dev,
  'pnpm services:up && pnpm --filter @bake-mall/api migration:run && pnpm -r --parallel --stream dev',
);
assert.equal(apiPackage.scripts.dev, 'nest start --watch');
assert.equal(
  apiBuildConfig.compilerOptions.tsBuildInfoFile,
  './dist/tsconfig.build.tsbuildinfo',
);
assert.match(h5ViteConfig, /strictPort:\s*true/);
assert.match(adminViteConfig, /strictPort:\s*true/);
```

- [ ] **步骤 2：运行测试确认失败**

```bash
node scripts/dev-config.test.mjs
```

预期：根 `dev`、API `dev`、缓存路径或严格端口至少一项断言失败。

- [ ] **步骤 3：实现最小配置修改**

修改根 `package.json`：

```json
"dev": "pnpm services:up && pnpm --filter @bake-mall/api migration:run && pnpm -r --parallel --stream dev",
"test:dev-config": "node scripts/dev-config.test.mjs"
```

修改 `apps/api/package.json`：

```json
"dev": "nest start --watch"
```

保留已有 `start:dev`，避免破坏现有命令。

修改 `apps/api/tsconfig.build.json`：

```json
"compilerOptions": {
  "rootDir": "./src",
  "tsBuildInfoFile": "./dist/tsconfig.build.tsbuildinfo"
}
```

将两个 Vite 配置的 `strictPort` 从 `false` 改为 `true`。

- [ ] **步骤 4：运行配置测试与格式检查**

```bash
node scripts/dev-config.test.mjs
pnpm exec prettier --check package.json apps/api/package.json apps/api/tsconfig.build.json apps/h5-store/vite.config.ts apps/admin-web/vite.config.ts scripts/dev-config.test.mjs
```

预期：全部退出 0。

---

### 任务 2：配置被忽略的本地运行环境

**文件：**

- 新建或更新：`apps/api/.env`（Git ignored）
- 更新：`apps/admin-web/.env.development.local`（Git ignored）

**接口：**

- API 读取 MySQL、MinIO、`PORT=3015` 和 `admin-local@example.com`。
- Admin 开发构建预填同一管理员。

- [ ] **步骤 1：确认环境文件被忽略**

```bash
git check-ignore -v apps/api/.env apps/admin-web/.env.development.local
```

预期：两个路径均匹配根 `.gitignore` 的 `.env.*` 或 `.env` 规则。

- [ ] **步骤 2：写入 API 本地配置**

`apps/api/.env` 使用：

```dotenv
NODE_ENV=development
PORT=3015
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=bake_mall
MYSQL_USER=bake_app
MYSQL_PASSWORD=bake_app_password
ADMIN_EMAIL=admin-local@example.com
ADMIN_PASSWORD=admin-password
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_BUCKET=bake-mall
OBJECT_STORAGE_ACCESS_KEY=minioadmin
OBJECT_STORAGE_SECRET_KEY=minioadmin
OBJECT_STORAGE_FORCE_PATH_STYLE=true
```

- [ ] **步骤 3：同步 Admin 开发预填配置**

`apps/admin-web/.env.development.local` 使用：

```dotenv
VITE_ADMIN_EMAIL=admin-local@example.com
VITE_ADMIN_PASSWORD=admin-password
```

- [ ] **步骤 4：确认环境文件没有进入 Git 状态**

```bash
git status --short
git check-ignore -v apps/api/.env apps/admin-web/.env.development.local
```

预期：两个环境文件不出现在 `git status`，且仍被忽略。

---

### 任务 3：验证 Nest 缓存修复和 API 构建

**文件：**

- 验证：`apps/api/tsconfig.build.json`

**接口：**

- Nest 删除 `dist` 时一并删除增量缓存。
- 干净构建生成 `apps/api/dist/main.js`。

- [ ] **步骤 1：删除旧的外置缓存和输出**

```bash
rm -f apps/api/tsconfig.build.tsbuildinfo
rm -rf apps/api/dist
```

这些路径均为可再生构建产物。

- [ ] **步骤 2：执行两次 API 构建**

```bash
pnpm --filter @bake-mall/api build
test -f apps/api/dist/main.js
pnpm --filter @bake-mall/api build
test -f apps/api/dist/main.js
```

预期：两次均成功生成 `dist/main.js`，不再出现“零错误但没有输出”的情况。

- [ ] **步骤 3：检查缓存位置**

```bash
test -f apps/api/dist/tsconfig.build.tsbuildinfo
test ! -f apps/api/tsconfig.build.tsbuildinfo
```

预期：缓存只存在于 `dist`。

---

### 任务 4：记录启动和任务可见性规范

**文件：**

- 修改：`.claude/CLAUDE.md`

**接口：**

- 后续 Claude 会话能直接获知启动命令、地址、账号和任务进度规范。

- [ ] **步骤 1：在“常用命令”中加入本地启动说明**

加入以下简洁规则：

```markdown
- `pnpm dev` — 一键启动或复用 MySQL/MinIO，执行迁移，并前台并行运行 API `3015`、H5 `5173`、Admin `5174`；`Ctrl-C` 只停止三个应用，`pnpm services:down` 完全关闭基础设施。
- 本地默认登录：H5 `13800000000 / 123456`；Admin `admin-local@example.com / admin-password`。凭据仅存于被忽略的应用级环境文件。
```

- [ ] **步骤 2：在“工作约定”中加入任务可见性规则**

加入：

```markdown
- 长任务使用 `TaskCreate` / `TaskUpdate` 维护少量用户可见的顶层任务，用户可用 `/tasks` 查看；子代理内部步骤不得创建为顶层任务。每完成一个顶层任务，主动播报 `进度 N/M`、结果和下一步；`.superpowers/sdd/progress.md` 仅用于会话恢复，不替代可见任务和里程碑播报。
```

- [ ] **步骤 3：检查上下文文件格式**

```bash
git diff --check -- .claude/CLAUDE.md
```

预期：退出 0。

---

### 任务 5：真实验证一键启动和停止

**文件：**

- 验证所有上述改动。

**接口：**

- 单条 `pnpm dev` 产生三个可访问应用。
- `Ctrl-C` 后应用退出，Compose 服务保留。

- [ ] **步骤 1：停止当前会话已启动的旧应用进程**

终止当前 API、H5、Admin 后台任务，保留 Compose 服务，避免固定端口冲突。

- [ ] **步骤 2：以前台后台跟踪方式执行单条命令**

```bash
pnpm dev
```

使用 Claude Code 的后台 Bash 跟踪该长期命令，以便后续发送停止信号。

预期日志顺序：Compose 启动/复用成功 → 无待迁移或迁移成功 → API/H5/Admin 三个带包名前缀的流式日志。

- [ ] **步骤 3：验证固定地址**

```bash
curl --fail --silent http://127.0.0.1:3015/api/v1/health
curl --fail --silent http://127.0.0.1:5173/login >/dev/null
curl --fail --silent http://127.0.0.1:5174/login >/dev/null
```

预期：全部成功，健康检查返回 `{"status":"ok"}`。

- [ ] **步骤 4：验证真实登录**

```bash
curl --fail --silent -H 'Content-Type: application/json' \
  -d '{"phone":"13800000000","code":"123456"}' \
  http://127.0.0.1:5173/api/v1/auth/dev/login >/dev/null

curl --fail --silent -H 'Content-Type: application/json' \
  -d '{"email":"admin-local@example.com","password":"admin-password"}' \
  http://127.0.0.1:5174/api/v1/admin/auth/login >/dev/null
```

预期：两个请求均为 2xx。

- [ ] **步骤 5：验证停止语义**

向根 `pnpm dev` 任务发送停止信号，然后执行：

```bash
! curl --fail --silent http://127.0.0.1:3015/api/v1/health
! curl --fail --silent http://127.0.0.1:5173/login
! curl --fail --silent http://127.0.0.1:5174/login
pnpm services:ps
```

预期：三个应用端口不可访问；MySQL 和 MinIO 仍为 healthy/running。

- [ ] **步骤 6：执行最终静态验证**

```bash
node scripts/dev-config.test.mjs
pnpm --filter @bake-mall/api build
git diff --check
git status --short
```

预期：配置测试与 API 构建通过；环境文件不在 Git 状态中；无关的既有未提交改动保持原样。
