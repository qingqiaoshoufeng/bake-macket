# Permission 收口与双端用户管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended); alternatively use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将所有既有 Admin endpoint 收口为默认 SUPER_ADMIN，仅向 OPERATOR 开放八项白名单，并在 Admin Web 与同一个原生小程序中交付安全的用户查看、手动添加、首次改密和管理入口。

**Architecture:** API 以 `AdminPermissionGuard` + endpoint 元数据执行默认拒绝；用户管理是独立 Nest 模块。Admin Web 扩展 auth profile、permission route meta 和 users 六职责页面。原生小程序先建立微信身份服务、`wx.request` 客户端和管理会话，再以六职责目录实现入口和用户管理，不通过 H5 postMessage 执行管理动作。

**Tech Stack:** NestJS 11、Vue 3、Element Plus、原生微信小程序 TypeScript、Pinia、Vitest、Supertest、微信服务端 API。

**前置：** `2026-08-04-miniapp-cloud-printing-1-identity.md` 全部阶段门通过。

---

## 文件结构

```text
apps/api/src/
├─ auth/wechat-auth.adapter.ts          微信 code/手机号 code 服务端 adapter
├─ auth/wechat-auth.service.ts          基于 wechat_credential_uses claim 的微信身份换取与 User 关联
├─ auth/admin-permission.*              默认拒绝 permission guard
├─ users/admin-users.controller.ts      用户列表/创建/角色查询
└─ users/admin-users.service.ts

apps/admin-web/src/views/users/
├─ components/UserTable.vue
├─ components/CreateUserDialog.vue
├─ components/OperatorGrantDialog.vue
├─ hooks/useUsers.ts
├─ hooks/useOperatorActions.ts
├─ mock/list.mock.ts
├─ config/columns.ts
├─ config/defaults.ts
├─ type/index.ts
├─ api/index.ts
├─ UsersView.vue
└─ index.ts

apps/miniapp-shell/
├─ config/api.generated.js              构建生成且被忽略的 API base
├─ config/api.generated.d.ts            提交的生成模块声明
├─ utils/api-client.ts
├─ utils/admin-session.ts
├─ admin/{components,hooks,mock,config,type,api}/
├─ pages/admin-home/*
├─ pages/admin-password/*
└─ pages/admin-users/*
```

### Task 1：锁定既有 Admin endpoint permission

**Files:**

- Modify: `apps/api/src/auth/admin-permission.guard.ts`
- Modify: `apps/api/src/auth/admin-permission.decorator.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: all controllers under `apps/api/src/{catalog,banner,homepage,membership,orders,upload}` using `JwtAdminGuard`
- Create: `apps/api/test/operator-permissions.e2e-spec.ts`

- [ ] **Step 1：写逐 endpoint deny-by-default RED 测试**

当前没有 dashboard API；本 Task 不创建 dashboard endpoint。构建 OPERATOR token，逐项断言现有订单 export/supply/supply-items、catalog/categories/products、banners、membership levels/purchases、homepage、upload、admin role 返回 403。未来新增的 dashboard 和任意 Admin endpoint 在未声明 permission 时由同一 guard 默认仅允许 SUPER_ADMIN。断言只开放：

```ts
await request(app).get('/api/v1/admin/orders').set(operatorHeaders).expect(200);
await request(app)
  .patch(`/api/v1/admin/orders/${order.id}/status`)
  .set(operatorHeaders)
  .send({ status: 'PROCESSING' })
  .expect(200);
await request(app).get('/api/v1/admin/users').set(operatorHeaders).expect(200);
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test:e2e -- operator-permissions.e2e-spec.ts
```

Expected: FAIL，现有 controller 只校验 `JwtAdminGuard`。

- [ ] **Step 3：实现默认 SUPER_ADMIN、显式白名单**

`AdminPermissionGuard` 规则固定：

```ts
const required = reflector.getAllAndOverride<readonly AdminPermission[]>(
  ADMIN_PERMISSIONS_KEY,
  [context.getHandler(), context.getClass()],
);
if (admin.role === AdminRole.SUPER_ADMIN) return true;
if (!required?.length) throw new ForbiddenException(/* shared code */);
if (!required.every((permission) => admin.permissions.includes(permission))) {
  throw new ForbiddenException(/* shared code */);
}
return true;
```

Admin controller 统一 `@UseGuards(JwtAdminGuard, AdminPermissionGuard)`；只有订单 list/getOne/updateStatus、用户 list/create 和后续 printing endpoint 加显式 `@RequireAdminPermissions`。export/supply 等不标记，默认仅 SUPER_ADMIN。

- [ ] **Step 4：运行权限矩阵**

```bash
pnpm --filter @bake-mall/api test:e2e -- operator-permissions.e2e-spec.ts admin-order-supply.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api lint
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add apps/api/src apps/api/test/operator-permissions.e2e-spec.ts
git commit -m "feat(api): enforce operator permission allowlist"
```

### Task 2：实现用户列表与手动 placeholder 创建 API

**Files:**

- Modify: `packages/shared-contracts/src/admin-user.ts`
- Modify: `apps/api/src/users/admin-users.controller.ts`
- Modify: `apps/api/src/users/admin-users.service.ts`
- Create: `apps/api/src/users/dto/admin-user-list-query.dto.ts`
- Create: `apps/api/src/users/dto/create-placeholder-user.dto.ts`
- Create: `apps/api/src/users/admin-users.service.spec.ts`
- Create: `apps/api/test/admin-users.e2e-spec.ts`

- [ ] **Step 1：写分页、脱敏和手机号唯一 RED 测试**

```ts
it('creates an unverified placeholder and returns a masked phone', async () => {
  const created = await service.createPlaceholder(admin, {
    phone: ' 13800000000 ',
  });
  expect(created).toMatchObject({
    phoneMasked: '138****0000',
    phoneVerified: false,
    isOperator: false,
  });
  expect(saved.phone).toBe('13800000000');
  expect(saved.phoneVerified).toBe(false);
});
```

覆盖分页、手机号/昵称/ID 搜索、重复冲突、并发唯一键、OPERATOR 仅有 USER_READ/USER_CREATE、响应无 OpenID/hash。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/users/admin-users.service.spec.ts
pnpm --filter @bake-mall/api test:e2e -- admin-users.e2e-spec.ts
```

Expected: FAIL。

- [ ] **Step 3：实现服务与 controller**

DTO class `implements` shared request。手机号规范化使用一个命名纯函数并共享给 OPERATOR 登录。列表 join AdminUser，但只投影角色状态。创建 placeholder 不设置 verified。审计 summary 只记录内部 user ID 和 `phonePresent: true`。

- [ ] **Step 4：运行测试**

```bash
pnpm --filter @bake-mall/api test -- src/users
pnpm --filter @bake-mall/api test:e2e -- admin-users.e2e-spec.ts operator-permissions.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/shared-contracts/src/admin-user.ts apps/api/src/users apps/api/test/admin-users.e2e-spec.ts
git commit -m "feat(api): add customer user management"
```

### Task 3：接通微信小程序真实顾客身份

**Files:**

- Modify: `packages/shared-contracts/src/auth.ts`
- Modify: `apps/api/src/config/env.schema.ts`
- Create: `apps/api/src/config/env.schema.spec.ts`
- Modify: `.env.development.example`
- Modify: `.env.production.example`
- Create: `apps/api/src/auth/wechat-auth.adapter.ts`
- Create: `apps/api/src/auth/wechat-auth.adapter.spec.ts`
- Create: `apps/api/src/auth/wechat-auth.service.ts`
- Create: `apps/api/src/auth/wechat-auth.service.spec.ts`
- Create: `apps/api/src/auth/dto/wechat-login.dto.ts`
- Create: `apps/api/src/auth/dto/wechat-phone.dto.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/test/wechat-auth.e2e-spec.ts`
- Modify: `apps/h5-store/src/views/login/hooks/useLogin.ts`
- Create: `apps/h5-store/src/views/login/hooks/useLogin.spec.ts`
- Modify: `apps/h5-store/src/views/login/api/index.ts`
- Modify: `apps/h5-store/src/stores/auth.ts`
- Modify: `apps/h5-store/src/stores/auth.spec.ts`

- [ ] **Step 0：加载前端项目技能**

执行本 Task 的 H5 改动前，必须通过 Skill 调用；CLI 不支持 Skill 时读取项目 skill 加载 `frontend-page-generator` 与 `js-functional-style`；按项目允许方式记录已加载结果。H5 API 只组合全局 client，hook 使用不可变状态和命名纯函数，组件不直接请求。

- [ ] **Step 1：写环境、adapter、credential claim 与 H5 接线 RED 测试**

`env.schema.spec.ts` 断言 production 必需 `WECHAT_APP_ID/WECHAT_APP_SECRET`。adapter 对 code2session、getPhoneNumber 设置 timeout，严格验证 openid/phone_info，映射 errcode，不把 secret/code 写日志。service 测试对 LOGIN 与 PHONE 分别覆盖 10 分钟 TTL、`sha256(credential)` 唯一 claim、并发只有一个 owner、过期 IN_PROGRESS 原子 reclaim、明确失败写 FAILED、成功写 COMPLETED。FAILED 和 COMPLETED 的同 hash 重放均不得再次调用 vendor；FAILED 返回同一脱敏失败分类，COMPLETED 从资源摘要重建响应。response snapshot 只保存 user/session 资源摘要，不保存 JWT 明文。

H5 测试向 `useLogin` 注入 `WECHAT_CODE` 与 `PHONE_CREDENTIAL`，断言分别调用新 API、把返回的完整顾客 session 写入 auth store，并移除“等待后端接通”提示路径。

```ts
it('rejects a response without a non-empty openid', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ session_key: 'secret' }));
  await expect(adapter.exchangeLoginCode('one-time')).rejects.toMatchObject({
    code: 'WECHAT_AUTH_FAILED',
  });
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/api test -- src/config/env.schema.spec.ts src/auth/wechat-auth.adapter.spec.ts src/auth/wechat-auth.service.spec.ts
pnpm --filter @bake-mall/h5-store test -- src/views/login/hooks/useLogin.spec.ts src/stores/auth.spec.ts
```

Expected: FAIL。

- [ ] **Step 3：实现 adapter 与身份服务**

新增 `POST /auth/wechat/login`（login code → mall-user session）和受 mall-user guard 保护的 `POST /auth/wechat/phone`（phone code → bind/merge → canonical 新 session）。两条链路都先对明文 credential 计算 SHA-256，再使用 0010 的 `wechat_credential_uses` 以 10 分钟 TTL claim `IN_PROGRESS`；唯一 hash 和条件更新保证并发只有一个 owner。外部微信调用必须在数据库事务外。明确失败写 `FAILED` 并保存稳定脱敏失败摘要；同 hash 重放返回同一失败且不重放 vendor。成功写 `COMPLETED`、`resource_user_id` 和不含 token 明文的 user/session 资源摘要；重放根据 `resource_user_id` 重新签发等价 session 响应，不从数据库读取明文 token。过期 `IN_PROGRESS` 才允许同 hash 原子 reclaim；未过期并发请求返回处理中冲突。手机号绑定只调用第一计划的 `UserIdentityService`/merge service。

H5 `views/login/api/index.ts` 在全局 client 上定义两个 endpoint；`useLogin.ts` 收到 bridge 的 `WECHAT_CODE`/`PHONE_CREDENTIAL` 后立即调用对应 API，并以返回 session 更新顾客 auth store，不再只显示等待提示。

- [ ] **Step 4：运行 HTTP 与安全测试**

```bash
pnpm --filter @bake-mall/api test -- src/auth
pnpm --filter @bake-mall/api test:e2e -- wechat-auth.e2e-spec.ts auth-isolation.e2e-spec.ts
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/h5-store test -- src/views/login/hooks/useLogin.spec.ts src/stores/auth.spec.ts
pnpm --filter @bake-mall/h5-store typecheck
pnpm --filter @bake-mall/h5-store lint
pnpm --filter @bake-mall/h5-store build
```

Expected: fake adapter 下 code 重放、错误码、合并、token audience 全部符合预期。

- [ ] **Step 5：提交**

```bash
git add packages/shared-contracts/src/auth.ts apps/api/src/auth apps/api/src/config .env.development.example .env.production.example apps/api/test/wechat-auth.e2e-spec.ts apps/h5-store/src/views/login apps/h5-store/src/stores/auth.ts apps/h5-store/src/stores/auth.spec.ts
git commit -m "feat(api): authenticate miniapp customer identities"
```

### Task 4：扩展 Admin Web 会话为角色和 permission 感知

**Files:**

- Modify: `apps/admin-web/src/stores/admin-auth.ts`
- Modify: `apps/admin-web/src/stores/admin-auth.spec.ts`
- Modify: `apps/admin-web/src/views/login/api/index.ts`
- Modify: `apps/admin-web/src/views/LoginView.vue`
- Modify: `apps/admin-web/src/views/LoginView.spec.ts`
- Modify: `apps/admin-web/src/router/index.ts`
- Modify: `apps/admin-web/src/router/index.spec.ts`
- Modify: `apps/admin-web/src/config/navigation.ts`
- Modify: `apps/admin-web/src/layouts/AdminLayout.vue`
- Modify: `apps/admin-web/src/layouts/AdminLayout.spec.ts`
- Create: `apps/admin-web/src/views/admin-password/AdminPasswordView.vue`
- Create: `apps/admin-web/src/views/admin-password/components/PasswordForm.vue`
- Create: `apps/admin-web/src/views/admin-password/hooks/useAdminPassword.ts`
- Create: `apps/admin-web/src/views/admin-password/hooks/useAdminPassword.spec.ts`
- Create: `apps/admin-web/src/views/admin-password/mock/session.mock.ts`
- Create: `apps/admin-web/src/views/admin-password/config/defaults.ts`
- Create: `apps/admin-web/src/views/admin-password/type/index.ts`
- Create: `apps/admin-web/src/views/admin-password/api/index.ts`
- Create: `apps/admin-web/src/views/admin-password/index.ts`

- [ ] **Step 0：加载前端项目技能**

执行本 Task 前，必须通过 Skill 调用；CLI 不支持 Skill 时读取项目 skill 加载 `frontend-page-generator` 与 `js-functional-style`；按项目允许方式记录已加载结果。页面模块必须具备 `components/hooks/mock/config/type/api`，所有请求经全局 client，状态转换返回新值。

- [ ] **Step 1：写角色路由、导航与普通改密 RED 测试**

```ts
it('redirects an operator from dashboard to orders', async () => {
  auth.applySession(operatorSession, { identifier: '13800000000' });
  await router.push('/dashboard');
  expect(router.currentRoute.value.fullPath).toBe('/orders');
});

it('shows only permission-backed navigation for operators', () => {
  expect(visiblePaths(OPERATOR_PERMISSIONS)).toEqual([
    '/orders',
    '/users',
    '/printing/devices',
    '/printing/batches',
  ]);
});
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/stores/admin-auth.spec.ts src/router/index.spec.ts src/layouts/AdminLayout.spec.ts src/views/LoginView.spec.ts
```

Expected: FAIL，store 只有 email/token。

- [ ] **Step 3：实现 session profile 与 permission route meta**

store 持久化 `AdminSessionView` 的 role/permissions/mustChangePassword；登录表单按用户选择构造 `{ kind: 'SUPER_ADMIN', email, password }` 与 `{ kind: 'OPERATOR', phone, password }` 两种联合分支。RouteMeta 增加 `requiredPermission`；OPERATOR 无 permission 时固定 redirect `/orders`。导航项带 permission，纯函数 filter 后渲染。SUPER_ADMIN 保持现有完整导航。新增 `/admin-password`，首次模式显示临时密码/新密码/确认值并调用首次改密 endpoint，普通模式显示当前密码/新密码/确认值并调用普通改密 endpoint；成功后用返回的新完整 session 原子替换 store。

- [ ] **Step 4：运行 Admin 基础门禁**

```bash
pnpm --filter @bake-mall/admin-web test -- src/stores src/router src/layouts src/views/LoginView.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add apps/admin-web/src/stores apps/admin-web/src/router apps/admin-web/src/config apps/admin-web/src/layouts apps/admin-web/src/views/LoginView* apps/admin-web/src/views/login apps/admin-web/src/views/admin-password
git commit -m "feat(admin): add role-aware admin sessions"
```

### Task 5：建立 Admin Web 用户管理六职责模块

**Files:**

- Create: `apps/admin-web/src/views/users/UsersView.vue`
- Create: `apps/admin-web/src/views/users/components/UserTable.vue`
- Create: `apps/admin-web/src/views/users/components/CreateUserDialog.vue`
- Create: `apps/admin-web/src/views/users/components/OperatorGrantDialog.vue`
- Create: `apps/admin-web/src/views/users/components/OperatorRevokeDialog.vue`
- Create: `apps/admin-web/src/views/users/hooks/useUsers.ts`
- Create: `apps/admin-web/src/views/users/hooks/useUsers.spec.ts`
- Create: `apps/admin-web/src/views/users/hooks/useOperatorActions.ts`
- Create: `apps/admin-web/src/views/users/hooks/useOperatorActions.spec.ts`
- Create: `apps/admin-web/src/views/users/mock/list.mock.ts`
- Create: `apps/admin-web/src/views/users/config/columns.ts`
- Create: `apps/admin-web/src/views/users/config/defaults.ts`
- Create: `apps/admin-web/src/views/users/type/index.ts`
- Create: `apps/admin-web/src/views/users/api/index.ts`
- Create: `apps/admin-web/src/views/users/index.ts`
- Modify: `apps/admin-web/src/router/index.ts`
- Modify: `apps/admin-web/src/config/navigation.ts`

- [ ] **Step 0：加载前端项目技能**

执行本 Task 前，必须通过 Skill 调用；CLI 不支持 Skill 时读取项目 skill 加载 `frontend-page-generator` 与 `js-functional-style`；按项目允许方式记录已加载结果。保持六职责目录完整，presentational components 不 fetch，hook 以不可变状态编排。

- [ ] **Step 1：写 hook RED 测试**

覆盖分页 stale-response 隔离、手机号创建、SUPER_ADMIN grant/revoke、OPERATOR 不暴露授权方法、密码字段在 finally 清除、错误不回显密码。

```ts
expect(operatorActions.canManageRoles.value).toBe(false);
expect(superActions.canManageRoles.value).toBe(true);
```

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/users
```

Expected: FAIL。

- [ ] **Step 3：实现六职责页面**

组件纯展示/emit，无 fetch；api 仅路径和 shared DTO；hooks 做不可变状态、并发序号、表单映射和二次验证。`mock/list.mock.ts` 使用 shared view。路由 `/users` 需要 USER_READ；Create 按钮需要 USER_CREATE；授权/撤销仅 role SUPER_ADMIN。

- [ ] **Step 4：运行前端门禁**

```bash
pnpm --filter @bake-mall/admin-web test -- src/views/users src/router/index.spec.ts src/layouts/AdminLayout.spec.ts
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/admin-web build
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add apps/admin-web/src/views/users apps/admin-web/src/router/index.ts apps/admin-web/src/config/navigation.ts
git commit -m "feat(admin): add customer user management"
```

### Task 6：建立原生小程序 API 与管理会话基础

**Files:**

- Modify: `.gitignore`
- Modify: `apps/miniapp-shell/scripts/config.mjs`
- Modify: `apps/miniapp-shell/scripts/build-check.mjs`
- Modify: `apps/miniapp-shell/scripts/build.mjs`
- Modify: `apps/miniapp-shell/config/h5.generated.d.ts`
- Generate and ignore: `apps/miniapp-shell/config/api.generated.js`
- Create and commit: `apps/miniapp-shell/config/api.generated.d.ts`
- Create: `apps/miniapp-shell/utils/api-client.ts`
- Create: `apps/miniapp-shell/utils/api-client.spec.ts`
- Create: `apps/miniapp-shell/utils/admin-session.ts`
- Create: `apps/miniapp-shell/utils/admin-session.spec.ts`
- Create: `apps/miniapp-shell/scripts/build-check.spec.mjs`
- Create: `apps/miniapp-shell/admin/api/api-boundary.spec.ts`
- Modify: `apps/miniapp-shell/app.ts`
- Modify: `apps/miniapp-shell/tsconfig.json`
- Modify: `apps/miniapp-shell/tsconfig.spec.json`

- [ ] **Step 1：写 URL、request 和 session RED 测试**

```ts
it('sends mall-admin only to same-origin /api/v1 admin paths', async () => {
  await client.get('/admin/users', { audience: 'admin' });
  expect(wxRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      url: 'https://mall.example.com/api/v1/admin/users',
      header: { Authorization: 'Bearer admin-token' },
    }),
  );
});
```

覆盖 URL query/hash 被剥离后只取 origin、HTTPS 同源、超时、ApiError、401 清对应会话、mall-user/admin token 不交叉、credential/token 不出现在 query/hash/log、管理 token 只存内存（不 `wx.setStorage`）。构建测试断言 `api.generated.js` 生成、被 `.gitignore` 忽略且 `api.generated.d.ts` 已提交。静态边界测试扫描 `apps/miniapp-shell/admin/**`，除 `utils/api-client.ts` 外出现 `wx.request` 即失败；所有原生 feature API 必须调用 `utils/api-client`。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/miniapp-shell test -- utils/api-client.spec.ts utils/admin-session.spec.ts admin/api/api-boundary.spec.ts
node --test apps/miniapp-shell/scripts/build-check.spec.mjs
```

Expected: FAIL。

- [ ] **Step 3：实现原生 API 基础**

构建使用 `new URL(MINIAPP_H5_URL).origin` 派生 `MINIAPP_API_BASE_URL=<origin>/api/v1`，明确丢弃 H5 URL 的 query/hash，不新增可漂移的第二域名。`scripts/build-check.mjs` 校验生成文件与声明匹配；`.gitignore` 只忽略 `config/api.generated.js`，`config/api.generated.d.ts` 提交。`api-client` 是全小程序唯一 `wx.request` 调用点，封装 timeout、JSON、ApiError 和 audience token；`admin-session` 与 customer session 都只存 App 内存。`app.ts` 暴露 customer/admin session 和现有 phone handoff。

- [ ] **Step 4：运行小程序门禁**

```bash
pnpm --filter @bake-mall/miniapp-shell test
pnpm --filter @bake-mall/miniapp-shell typecheck
pnpm --filter @bake-mall/miniapp-shell lint
pnpm --filter @bake-mall/miniapp-shell build:check
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add apps/miniapp-shell/config apps/miniapp-shell/scripts apps/miniapp-shell/utils apps/miniapp-shell/app.ts apps/miniapp-shell/tsconfig*
git commit -m "feat(miniapp): add secure admin api sessions"
```

### Task 7：实现小程序管理入口、首次改密与用户管理

**Files:**

- Modify: `apps/miniapp-shell/app.json`
- Modify: `apps/miniapp-shell/pages/index/index.ts`
- Modify: `apps/miniapp-shell/pages/index/index.wxml`
- Create: `apps/miniapp-shell/admin/api/index.ts`
- Create: `apps/miniapp-shell/admin/type/index.ts`
- Create: `apps/miniapp-shell/admin/config/navigation.ts`
- Create: `apps/miniapp-shell/admin/mock/users.mock.ts`
- Create: `apps/miniapp-shell/admin/hooks/admin-auth.ts`
- Create: `apps/miniapp-shell/admin/hooks/admin-auth.spec.ts`
- Create: `apps/miniapp-shell/admin/hooks/users.ts`
- Create: `apps/miniapp-shell/admin/hooks/users.spec.ts`
- Create: `apps/miniapp-shell/admin/components/user-list/index.ts`
- Create: `apps/miniapp-shell/admin/components/user-list/index.json`
- Create: `apps/miniapp-shell/admin/components/user-list/index.wxml`
- Create: `apps/miniapp-shell/admin/components/user-list/index.wxss`
- Create: `apps/miniapp-shell/pages/admin-home/index.{ts,json,wxml,wxss}`
- Create: `apps/miniapp-shell/pages/admin-password/index.{ts,json,wxml,wxss}`
- Create: `apps/miniapp-shell/pages/admin-users/index.{ts,json,wxml,wxss}`

- [ ] **Step 1：写资格、受限会话和用户列表 RED 测试**

覆盖：非管理员无入口；点击原生管理入口时执行 fresh `wx.login` 并调用微信登录 API，把新 customer token 只写 App 内存；不复用已经交给 H5 的 code/token；OPERATOR 换 admin session；管理流程需要手机号时通过现有原生 phone 页；管理流程缺少该页时创建同职责入口取得 fresh phone code，绝不复用已交 H5 的 PHONE_CREDENTIAL；mustChange 强制首次密码页；完整会话可进入普通改密模式；两种模式均为三字段改密；撤权 401 清 admin session；用户分页、添加手机号和错误提示。

- [ ] **Step 2：运行并确认 RED**

```bash
pnpm --filter @bake-mall/miniapp-shell test -- admin/hooks
```

Expected: FAIL。

- [ ] **Step 3：实现原生页面和六职责适配**

`pages/index` 增加原生管理入口按钮，但不向 H5 URL 注入 customer/admin token。入口每次调用 fresh `wx.login` → `/auth/wechat/login`，customer token 只留 App 内存；该 code 不与 H5 bridge 共享。需要手机号时使用现有原生 phone 页；管理流程缺少该页时新增同职责入口获取 fresh phone code，再调用 `/auth/wechat/phone`。Hooks 为纯控制器，页面只绑定 data/event；API 只调用 `utils/api-client` 并拼 endpoint；type 重用 contracts；config 定义导航；mock 用于测试。`user-list` 使用真正四件套组件目录，`pages/admin-users/index.json` 通过 `usingComponents` 注册。小程序中 OPERATOR 不显示授权/撤销；`admin-password` 依据 session 支持首次与普通改密模式。

- [ ] **Step 4：运行全门禁和构建**

```bash
pnpm --filter @bake-mall/miniapp-shell test
pnpm --filter @bake-mall/miniapp-shell typecheck
pnpm --filter @bake-mall/miniapp-shell lint
MINIAPP_H5_URL=https://mall.example.com/ pnpm --filter @bake-mall/miniapp-shell build
```

Expected: PASS，生成 URL 不含 token/secret。

- [ ] **Step 5：提交**

```bash
git add apps/miniapp-shell
git commit -m "feat(miniapp): add operator user management"
```

### Task 8：阶段二完整验证

- [ ] **Step 1：运行所有相关 package 门禁**

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/api test
pnpm --filter @bake-mall/api test:e2e -- operator-permissions.e2e-spec.ts admin-users.e2e-spec.ts wechat-auth.e2e-spec.ts
pnpm --filter @bake-mall/admin-web test
pnpm --filter @bake-mall/admin-web typecheck
pnpm --filter @bake-mall/admin-web lint
pnpm --filter @bake-mall/h5-store test
pnpm --filter @bake-mall/h5-store typecheck
pnpm --filter @bake-mall/h5-store lint
pnpm --filter @bake-mall/h5-store build
pnpm --filter @bake-mall/miniapp-shell verify
```

- [ ] **Step 2：运行构建和格式**

```bash
pnpm --filter @bake-mall/api build
pnpm --filter @bake-mall/admin-web build
pnpm exec prettier --check packages/shared-contracts/src apps/api/src apps/api/test apps/admin-web/src apps/miniapp-shell
pnpm verify:workspace
git diff --check
```

- [ ] **Step 3：浏览器与开发者工具验收**

Admin Web 分别用 SUPER_ADMIN/OPERATOR 验证默认落点、导航和 403；微信开发者工具验证普通用户无入口、OPERATOR 首次改密和用户查看/添加。不得使用前端隐藏代替 API 403 证据。

- [ ] **Step 4：审查**

运行一轮身份/权限专项 review 和一轮前端结构 review，修复后复验。

- [ ] **Step 5：提交阶段收口**

```bash
git add packages/shared-contracts apps/api apps/admin-web apps/miniapp-shell
git commit -m "feat: complete operator user management"
```
