# CLAUDE.md

本文档为 Claude Code (claude.ai/code) 在本仓库工作时提供指引。

## 项目

`bake-mall` 是单商家烘焙商城,设计规格见 `docs/superpowers/specs/2026-07-12-bake-mall-design.md`,实施计划见 `docs/superpowers/plans/2026-07-12-bake-mall-mvp.md`。请将设计规格与计划视为范围、契约与验收标准的权威依据。

技术栈与约束:

- pnpm 9.15.4 workspace,Node >= 22.13。
- 仅使用静态 SPA 架构 — 不使用 Nuxt 或任何 SSR。
- H5 商城使用 Vue 3 + Vite + Vant 4,搭配“小清新”柔和色系。
- 商家后台使用 Vue 3 + Vite + Element Plus,搭配“浅色动漫”色系。
- 小程序是原生薄壳,内嵌 H5 的 `web-view`,负责桥接微信登录与手机号授权。
- 后端使用 NestJS 11 + TypeORM + MySQL 8;价格/数量均为整数分;订单以不可变快照形式持久化,需带 `Idempotency-Key`;首笔事务需原子提交并按条件扣减库存。
- 本地服务通过 Docker Compose 启动(MySQL 8.4 + MinIO,并自动创建 `bake-mall` bucket);所有发布端口均绑定到 `127.0.0.1`。
- 共享 TypeScript 契约位于 `packages/shared-contracts`,以 `@bake-mall/contracts` 导入;视为跨应用 DTO / 枚举 / 状态的单一事实来源。

## 常用命令

在 workspace 根目录运行:

- `pnpm install` 然后 `pnpm verify:workspace` — 安装依赖并确认 workspace 文件齐全。
- `pnpm lint` — 对根 `*.mjs`、`scripts/` 以及各子包执行 ESLint。
- `pnpm typecheck`、`pnpm test`、`pnpm build` — 递归的 workspace 检查。
- `pnpm format:check` / `pnpm format` — Prettier 校验 / 格式化。
- `pnpm services:up` / `services:ps` / `services:down` — 通过 `scripts/compose.mjs` 启动基于分支隔离的本地 MySQL + MinIO。
- `pnpm --filter @bake-mall/contracts test|typecheck|build` — 对共享契约单独校验。
- `pnpm --filter @bake-mall/api start:dev` — 以 watch 模式运行 Nest API,接入本地 MySQL / MinIO,最快的开发循环。
- `pnpm --filter @bake-mall/api test:e2e -- <spec>.e2e-spec.ts` — 单独跑某个 NestJS e2e 测试(vitest;会自动追加 `--root . test/`)。
- `pnpm --filter @bake-mall/api migration:run` — 执行待应用的 TypeORM 迁移;`data-source.ts` 内部已调用 `dotenv`,所以只要 shell 中环境变量存在,`sourced .env` 不是必须的(但仍建议提供)。

## 架构地图

- `apps/api` — NestJS 11 服务(CommonJS 输出)。`main.ts` 启动全局 `/api/v1` 前缀和严格的 `ValidationPipe`;health controller 被显式排除在前缀之外,以避免重复应用。`config/env.schema.ts` 是与迁移 CLI 共享的唯一类型化配置源;`database/database.module.ts` 以 `synchronize: false` 装配 TypeORM;`database/migrations/` 存放版本化迁移。测试使用 **vitest**(单元 + e2e 在同一个二进制中,`--root . test/` 隔离 e2e 树)。新增的 Nest 源文件必须使用 **`.js` 导入后缀**(NodeNext 互操作),即使 `tsconfig.json` 输出为 CommonJS —— TS 在编译时会把 `./foo.js` 解析为 `./foo.ts`。
  - **Schema 约定** 由 `database/migrations/0001-initial-schema.ts` 锁定:`utf8mb4` / `utf8mb4_unicode_ci`、`BIGINT UNSIGNED` 主键、金额 / 数量使用 `INT UNSIGNED`、时间戳存为 UTC 的 `DATETIME`(运行时 `timezone: 'Z'`)。新增迁移 / 实体都必须遵守。
- `packages/shared-contracts` — DTO、枚举、`ApiError`、订单 `canTransitionOrder` 辅助函数,以及 `CreateOrderRequest` 与 `BannerView` 的可辨识联合。包以 ESM 输出;消费者(NestJS)通过 `require` / `import` 读取。测试使用 vitest,并依赖 **`@ts-expect-error` 类型级断言**(见 `src/order.ts`、`src/catalog.ts`)证明可辨识联合的非法形态会被拒绝 —— `canTransitionOrder` 则由运行时测试直接覆盖。
- `apps/h5-store`、`apps/admin-web`、`apps/miniapp-shell` — Vite / Vue / 小程序前端(撰写本文档时尚未脚手架;预期位于 `apps/` 下)。
- `infra/docker-compose.dev.yml` + `scripts/compose.mjs` — 基于分支派生的 Compose 项目名,用于本地服务引导。
- `scripts/compose-project-name.test.mjs` — 分支名到项目名净化的单元测试辅助;`services:up` / `services:ps` / `services:down` 需要与之保持一致。
- `docs/superpowers/specs/`、`docs/superpowers/plans/`、`.superpowers/sdd/` — 设计、计划与每个任务的简报 / 报告。`.superpowers` 目录被 `.gitignore` 忽略;重建上下文所需的全部信息也已落地于已提交的 specs / plans / commit 历史中。
- 根 `eslint.config.mjs` 仅检查根目录下的 JS / 脚本以及 Vue SFC fixture;每个 workspace 的 ESLint 通过 `pnpm -r lint` 负责各自的源码。

## 工作约定

- 任何跨 API 或应用边界的 DTO 必须使用 `@bake-mall/contracts` 中的类型,不得重复定义。
- 金额字段使用整数分(`priceCents`、`unitPriceCents`、`goodsTotalCents`);严禁对金额使用浮点数。
- 订单快照不可变:`CreateOrderRequest` 按 `FulfillmentType` 构成可辨识联合;`OrderView` 同时保留可选的 `pickupTimeText` / `deliveryAddressText`,以便消费者按需读取。
- 订单状态机:`NEW → PROCESSING → {COMPLETED | CANCELLED}`;`canTransitionOrder` 是共享谓词。取消订单不会回补库存。
- 身份令牌分两种:`mall-user` 用于顾客,`mall-admin` 用于商家员工;不允许任一 audience 访问另一方的接口。
- 按计划遵循 TDD:先写失败的测试,跑一遍,然后实现,最后提交。
- 前端硬约束:任何对 `apps/h5-store/` 与 `apps/admin-web/` 的改动都必须先读 `.claude/skills/frontend-page-generator/SKILL.md` 与 `.claude/skills/js-functional-style/SKILL.md`。五模块拆分(`components/` `hooks/` `mock/` `config/` `type/` `api/`)与不可变/ES6 编码规则是强制要求,不是建议。
