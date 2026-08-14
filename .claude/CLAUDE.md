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
- `pnpm dev` — 首次缺少根 `.env.development` 时从 `.env.development.example` 自动复制,启动或复用 MySQL / MinIO,构建共享契约,执行迁移,并前台并行运行 API `43015`、H5 `43173`、Admin `43174`;`Ctrl-C` 只停止三个应用,`pnpm services:down` 完全关闭基础设施。
- 本地基础设施默认端口:MySQL `43306`、MinIO API `43900`、MinIO Console `43901`;开发/生产模板分别为 `.env.development.example` 与 `.env.production.example`。H5/Admin dev 与 preview 允许 `12297oy2ga916.vicp.fun`。
- 本地默认登录:H5 `13800000000 / 123456`;Admin `admin-local@example.com / admin-password`。凭据仅存于被忽略的根 `.env.development`。
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
- `apps/h5-store`、`apps/admin-web` — Vue 3 + Vite 静态 SPA,从仓库根读取端口配置并代理到 `PORT`;`apps/miniapp-shell` 是小程序薄壳。
- `.env.development.example` / `.env.production.example` — 分别是可复制的本地默认配置与不含真实 secret 的生产变量清单;实际 `.env.development` 被 Git 忽略。
- `infra/docker-compose.dev.yml` + `scripts/compose.mjs` — 基于分支派生 Compose 项目名,读取根 `.env.development` 并参数化本地端口与凭据。
- `scripts/compose-project-name.test.mjs` — 分支名到项目名净化的单元测试辅助;`services:up` / `services:ps` / `services:down` 需要与之保持一致。
- `docs/superpowers/specs/`、`docs/superpowers/plans/`、`.superpowers/sdd/` — 设计、计划与每个任务的简报 / 报告。`.superpowers` 目录被 `.gitignore` 忽略;重建上下文所需的全部信息也已落地于已提交的 specs / plans / commit 历史中。
- 根 `eslint.config.mjs` 仅检查根目录下的 JS / 脚本以及 Vue SFC fixture;每个 workspace 的 ESLint 通过 `pnpm -r lint` 负责各自的源码。

## 工作约定

- 与用户沟通以及所有需求与研发流程文档默认使用中文,包括需求分析、brainstorming 记录、设计规格、实施计划、任务简报、进度记录、实施报告、审查报告、验收记录和交接说明;该规则适用于 `docs/superpowers/specs/`、`docs/superpowers/plans/`、`.superpowers/sdd/` 及后续新增的同类目录。代码、命令、路径、API、标识符及必要技术术语保留英文。即使上游 skill 提供英文模板,也必须保留其结构并将标题、章节名、任务描述、步骤、预期结果和说明等自然语言内容本地化为中文。
- 仅当任务包含至少 3 个实质步骤或预计超过 20 分钟时,使用 `TaskCreate` / `TaskUpdate` 维护少量用户可见的顶层待办,用户可按 `Ctrl+T` 显示或隐藏待办列表,也可直接要求列出全部待办;`/tasks` 仅用于后台 shell 与 subagent。子代理内部步骤不得创建为顶层待办。每完成一个顶层待办,主动播报 `进度 N/M`、结果和下一步;`.superpowers/sdd/progress.md` 仅用于确有跨会话恢复需求的长任务,不替代结构化待办和里程碑播报。

### Superpowers 流程分级

Superpowers 保持启用,但不得对所有任务机械执行完整流程。用户当前明确要求与本文件中的项目级流程规则优先于 Superpowers skill 的默认建议。

#### 默认快速流程

当需求明确、风险较低且预计修改不超过 3 个主要文件时:

1. 直接检查相关代码并用少量文字说明实现思路。
2. 不调用 `superpowers:brainstorming`,不进入 Plan Mode,不生成独立 spec、plan、brief 或 report。
3. 不创建额外 worktree;当前已在 worktree 或独立分支时尤其不得重复创建。
4. 不派发 subagent,不自动调用额外 code review 或 simplify agent。
5. 修改后仅运行受影响包的最小相关测试、typecheck、lint 或格式检查。
6. 文档、文案、样式、配置及无行为变化的机械重构不要求严格执行 red-green TDD。

#### 标准流程

普通业务功能或中等范围 bug 修复:

1. 仅当需求存在会影响实现的实质性歧义时调用 `superpowers:brainstorming`。
2. 在对话中给出简短实现步骤,不生成独立计划文档。
3. 对业务行为执行 TDD,实现后运行定向测试和相关包 typecheck。
4. 除非改动复杂、需要大范围搜索或用户明确要求,否则不使用 subagent 和额外 review。

#### 完整流程

仅在以下任一情况使用 brainstorming、书面计划、严格 TDD、必要的 subagent、专项 review 与完整验证:

- 数据库 schema 或迁移;
- `@bake-mall/contracts` 共享契约;
- 订单、库存、金额、鉴权、幂等或状态机;
- 跨 API、H5、Admin 或小程序的接口变更;
- 预计修改超过 5 个主要文件;
- 需求存在重要产品或架构决策;
- 用户明确要求完整 Superpowers 流程。

完整流程也应避免重复产物与重复检查:已有权威 spec 或 plan 时不重新生成;同一改动默认只运行一轮相应层级的 review;开发中优先定向验证,提交或 PR 前再执行全量检查。

#### 单项 skill 使用规则

- `superpowers:systematic-debugging`:仅用于原因未知的故障、测试失败或异常行为。
- `superpowers:test-driven-development`:用于行为变更与 bug 修复;文档、纯视觉调整、配置及无行为机械重构可跳过严格 red-green 顺序。
- `superpowers:writing-plans`:仅用于完整流程任务;已有用户认可的实施计划时直接沿用。
- `superpowers:using-git-worktrees`:仅在用户明确要求 worktree 时使用;当前已在 worktree 或独立分支时不得重复创建。
- `superpowers:subagent-driven-development`:仅用于多个可独立并行的任务或主上下文无法有效覆盖的大范围工作。
- `superpowers:requesting-code-review`:仅用于高风险改动、重大功能或提交 / PR 前;不得与其他同类 reviewer 机械串行重复审查。
- `superpowers:finishing-a-development-branch`:仅在用户准备提交、创建 PR、合并或清理分支时使用。
- `superpowers:verification-before-completion`:代码行为变更仍需使用,但验证范围应匹配改动影响,不默认运行全仓检查。
- 任何跨 API 或应用边界的 DTO 必须使用 `@bake-mall/contracts` 中的类型,不得重复定义。
- 金额字段使用整数分(`priceCents`、`unitPriceCents`、`goodsTotalCents`);严禁对金额使用浮点数。
- 订单快照不可变:`CreateOrderRequest` 按 `FulfillmentType` 构成可辨识联合;`OrderView` 同时保留可选的 `pickupTimeText` / `deliveryAddressText`,以便消费者按需读取。
- 订单状态机:`NEW → PROCESSING → {COMPLETED | CANCELLED}`;`canTransitionOrder` 是共享谓词。取消订单不会回补库存。
- 身份令牌分两种:`mall-user` 用于顾客,`mall-admin` 用于商家员工;不允许任一 audience 访问另一方的接口。
- 按计划遵循 TDD:先写失败的测试,跑一遍,然后实现,最后提交。
- 前端硬约束:任何对 `apps/h5-store/`、`apps/admin-web/` 与 `apps/miniapp-shell/` 运行时代码的改动都必须先读 `.claude/skills/frontend-page-generator/SKILL.md`、`.claude/skills/js-functional-style/SKILL.md` 与 `.claude/skills/frontend-runtime-compat/SKILL.md`。六模块拆分(`components/` `hooks/` `mock/` `config/` `type/` `api/`)、不可变/ES6 编码规则与目标运行时兼容基线都是强制要求,不是建议。TypeScript `target/lib`、Vite/微信编译成功或现代 Chrome 通过均不得作为 Safari/微信 WebView 运行时 API 兼容的证明。
