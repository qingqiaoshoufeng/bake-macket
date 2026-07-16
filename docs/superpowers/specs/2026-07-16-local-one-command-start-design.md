# 本地一键启动设计

**状态：** 已批准

## 目标

通过根目录单条命令 `pnpm dev` 完成 MySQL、MinIO、数据库迁移、API、H5 商城和商家后台的本地启动，并保证固定端口、默认开发账号和可预测的停止行为。

## 命令与运行方式

`pnpm dev` 按顺序执行：

1. `pnpm services:up`，启动或复用当前分支对应的 MySQL 与 MinIO Compose 服务。
2. `pnpm --filter @bake-mall/api migration:run`，应用待执行迁移。
3. `pnpm -r --parallel --stream dev`，前台并行运行 API、H5 和商家后台，并显示带包名前缀的日志。

按 `Ctrl-C` 停止三个应用进程，但保留 MySQL 与 MinIO，便于下次快速启动。完全关闭基础设施使用 `pnpm services:down`。

## 应用配置

- API 新增 `dev` script，使用 `nest start --watch`。
- API 固定监听 `3015`；H5 固定监听 `5173`；商家后台固定监听 `5174`。
- 两个 Vite 应用启用严格端口，端口占用时立即失败，不自动切换地址。
- API 的本地 MySQL、MinIO、端口和管理员配置放在被 Git 忽略的 `apps/api/.env`。
- Admin 的开发表单预填配置放在被 Git 忽略的 `apps/admin-web/.env.development.local`，生产构建不读取该文件。
- 默认本地账号：
  - H5：`13800000000 / 123456`
  - Admin：`admin-local@example.com / admin-password`

## Nest 增量缓存修复

`apps/api/tsconfig.build.json` 将 `tsBuildInfoFile` 显式设置为 `./dist/tsconfig.build.tsbuildinfo`。Nest 的 `deleteOutDir: true` 删除 `dist` 时会一并删除缓存，避免出现编译报告零错误但未生成 `dist/main.js` 的情况。

## 错误处理

- Docker、迁移任一步失败时，不启动三个应用，根命令以非零状态退出。
- 固定端口被占用时，相应应用立即失败并显示冲突。
- 已存在管理员不会被 seed 覆盖；使用未冲突的 `admin-local@example.com`。
- 本地环境文件必须保持 Git ignored，不在跟踪文件中保存密码。

## 测试与验收

1. 验证 API build config 的缓存路径位于 `dist`。
2. 验证三个 workspace package 都提供 `dev` script。
3. 验证根 `dev` 的准备步骤严格串行，长期进程并行且输出流式日志。
4. 在干净 API build cache 下执行构建，确认生成 `apps/api/dist/main.js`。
5. 实际运行 `pnpm dev`，验证：
   - `http://127.0.0.1:3015/api/v1/health`
   - `http://127.0.0.1:5173/login`
   - `http://127.0.0.1:5174/login`
6. 通过两个 Vite 代理分别真实登录 H5 与 Admin。
7. 按 `Ctrl-C` 后三个应用退出，Compose 服务仍保持运行。

## Claude Code 上下文记录

在 `.claude/CLAUDE.md` 中记录：

- 一键启动和完全停止命令、固定地址及默认本地账号。
- 长任务使用 `TaskCreate` / `TaskUpdate` 维护少量顶层任务，用户可通过 `/tasks` 查看。
- 子代理的内部步骤不得作为顶层任务创建，避免污染可见列表。
- 每完成一个顶层任务，主动播报 `进度 N/M`、当前结果和下一步。
- `.superpowers/sdd/progress.md` 只用于持久恢复，不替代用户可见任务和里程碑播报。

## 非目标

- 不引入 `concurrently`、Turbo、Nx 或自定义 Node supervisor。
- 不在 `Ctrl-C` 时自动关闭 Docker 服务。
- 不修改生产部署流程。
