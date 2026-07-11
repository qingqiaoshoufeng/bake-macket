# 烘焙商城 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付支持商品多 SKU、购物车、两种履约下单和商家订单处理的烘焙商城 H5、PC 后台、微信小程序容器及 NestJS 后端。

**Architecture:** 使用 pnpm workspace 管理四个独立应用和一套共享 API 契约。NestJS + MySQL 作为唯一业务真相源，采用 TypeORM 事务实现幂等下单与条件库存扣减；H5 与后台为 Vue 3 SPA，分别使用 Vant 4 和 Element Plus，小程序仅承载 `web-view` 并桥接微信能力。

**Tech Stack:** Node.js 22、pnpm 9、TypeScript 5、Vue 3、Vite、Vant 4、Element Plus、NestJS 11、TypeORM、MySQL 8、Vitest、Playwright、原生微信小程序、腾讯云 COS SDK。

## Global Constraints

- 使用 pnpm workspace Monorepo；`packages/shared-contracts` 只放 DTO、枚举和共享类型，禁止包含应用业务实现。
- H5 和 PC 后台均为 Vite 构建的 SPA；首期禁止引入 Nuxt 或任何 SSR。
- H5 必须使用 Vant 4 与小清新视觉：奶油白、浅草绿、暖杏色、清晰商品图与移动端可访问交互。
- PC 后台必须使用 Element Plus 与轻二次元视觉：紫罗兰/粉色点缀、圆角和插画；不得牺牲表格、表单和筛选效率。
- 价格、金额和库存变更使用整数分与整数数量；禁止浮点金额。
- 商品必须支持多 SKU，SKU 独立维护售价、库存、状态与可选图片。
- 下单前必须是已登录且手机号已验证的商城用户。
- 创建订单必须在一个 MySQL 事务内条件扣库存、写订单快照、清购物车，并用用户级 `Idempotency-Key` 防重复提交。
- 订单商品、价格、联系人和履约信息创建后不可修改；取消订单不回补库存。
- 订单状态只允许 `NEW → PROCESSING → COMPLETED` 或 `NEW → PROCESSING → CANCELLED`。
- 首期支持到店自提（自由文本取货时间）和同城配送（地址）；配送费恒为零，不展示计费规则。
- 管理员与商城用户必须使用独立 JWT 密钥、audience、守卫和登录端点。
- 图片上传腾讯云 COS；数据库不存图片二进制；富文本必须由服务端 HTML 白名单清洗后渲染。
- 首期不实现真实微信支付、短信发送、退款、配送费、库存回补、员工权限、多门店或场景导购配置。

---

## Locked File Structure

```text
package.json                         # 根脚本、包管理器约束
pnpm-workspace.yaml                  # workspace 定义
pnpm-lock.yaml                       # 锁定依赖
eslint.config.mjs                    # TypeScript/Vue/NestJS 通用静态检查
prettier.config.mjs                  # 格式化约束
.env.example                         # 仅变量名和安全示例值
apps/api/                            # NestJS API、迁移、单元与集成测试
apps/h5-store/                       # Vue + Vant 顾客端
apps/admin-web/                      # Vue + Element Plus 商家端
apps/miniapp-shell/                  # 微信小程序容器
packages/shared-contracts/           # API DTO、枚举与类型
infra/docker-compose.dev.yml         # 本地 MySQL、MinIO（COS 兼容）
infra/api.Dockerfile                 # API 容器镜像
infra/nginx.conf                     # SPA 回退及 API 反向代理示例
docs/runbook/local-development.md    # 本地启动说明
docs/runbook/wechat-cos-setup.md     # 微信、COS、白名单部署说明
```

---

### Task 1: 建立 Monorepo、质量门禁和本地服务

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `.env.example`
- Create: `infra/docker-compose.dev.yml`
- Create: `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 当前规格 [`docs/superpowers/specs/2026-07-12-bake-mall-design.md`](../specs/2026-07-12-bake-mall-design.md)。
- Produces: 所有后续任务可调用的根命令 `pnpm lint`、`pnpm test`、`pnpm typecheck`、`pnpm dev` 与本地 MySQL `localhost:3306`。

- [ ] **Step 1: 写入根 workspace 配置与统一命令。**

```json
{
  "name": "bake-mall",
  "private": true,
  "packageManager": "pnpm@9.15.4",
  "engines": { "node": ">=22.0.0", "pnpm": ">=9.15.0" },
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "format:check": "prettier --check .",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@eslint/js": "^9.21.0",
    "eslint": "^9.21.0",
    "prettier": "^3.5.3",
    "typescript": "^5.8.2",
    "typescript-eslint": "^8.24.0"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

- [ ] **Step 2: 创建本地 MySQL 与 MinIO 服务。**

```yaml
# infra/docker-compose.dev.yml
services:
  mysql:
    image: mysql:8.4
    environment:
      MYSQL_DATABASE: bake_mall
      MYSQL_USER: bake_app
      MYSQL_PASSWORD: bake_app_password
      MYSQL_ROOT_PASSWORD: local_root_password
    ports: ["3306:3306"]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 3s
      retries: 20
  minio:
    image: minio/minio:RELEASE.2025-02-28T09-55-16Z
    command: server /data --console-address :9001
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
```

- [ ] **Step 3: 写入最小根校验测试（配置存在性）。**

Create `scripts/verify-workspace.mjs`:

```js
import { existsSync } from 'node:fs';

for (const file of ['pnpm-workspace.yaml', 'tsconfig.base.json', 'infra/docker-compose.dev.yml']) {
  if (!existsSync(file)) throw new Error(`Missing workspace file: ${file}`);
}
console.log('workspace configuration is complete');
```

Add `"verify:workspace": "node scripts/verify-workspace.mjs"` to root scripts.

- [ ] **Step 4: 安装依赖并确认基础校验成功。**

Run: `pnpm install && pnpm verify:workspace && docker compose -f infra/docker-compose.dev.yml up -d`

Expected: workspace 输出 `workspace configuration is complete`；两个容器均启动，MySQL healthcheck 为 healthy。

- [ ] **Step 5: 提交基础工程。**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs prettier.config.mjs .env.example .gitignore infra/docker-compose.dev.yml README.md scripts/verify-workspace.mjs pnpm-lock.yaml
git commit -m "chore: bootstrap bake mall workspace"
```

### Task 2: 定义共享领域枚举、DTO 与 API 错误契约

**Files:**
- Create: `packages/shared-contracts/package.json`
- Create: `packages/shared-contracts/tsconfig.json`
- Create: `packages/shared-contracts/src/enums.ts`
- Create: `packages/shared-contracts/src/catalog.ts`
- Create: `packages/shared-contracts/src/order.ts`
- Create: `packages/shared-contracts/src/auth.ts`
- Create: `packages/shared-contracts/src/errors.ts`
- Create: `packages/shared-contracts/src/index.ts`
- Create: `packages/shared-contracts/src/order.spec.ts`

**Interfaces:**
- Produces: `OrderStatus`, `FulfillmentType`, `BannerTargetType`, `ApiErrorCode`, `SkuView`, `CreateOrderRequest`, `OrderView`；后端和两个 Vue 应用均从 `@bake-mall/contracts` 导入。
- Invariants: `priceCents`、`goodsTotalCents` 为 `number` 整数；订单状态只使用固定联合类型。

- [ ] **Step 1: 编写状态机失败测试。**

```ts
import { canTransitionOrder } from './order';
import { OrderStatus } from './enums';

it('allows only the specified order transitions', () => {
  expect(canTransitionOrder(OrderStatus.NEW, OrderStatus.PROCESSING)).toBe(true);
  expect(canTransitionOrder(OrderStatus.PROCESSING, OrderStatus.COMPLETED)).toBe(true);
  expect(canTransitionOrder(OrderStatus.PROCESSING, OrderStatus.CANCELLED)).toBe(true);
  expect(canTransitionOrder(OrderStatus.NEW, OrderStatus.COMPLETED)).toBe(false);
  expect(canTransitionOrder(OrderStatus.COMPLETED, OrderStatus.PROCESSING)).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `pnpm --filter @bake-mall/contracts test -- order.spec.ts`

Expected: FAIL，提示 `Cannot find module './order'` 或 `canTransitionOrder is not a function`。

- [ ] **Step 3: 实现枚举、订单 DTO 和状态函数。**

```ts
// packages/shared-contracts/src/enums.ts
export enum OrderStatus { NEW = 'NEW', PROCESSING = 'PROCESSING', COMPLETED = 'COMPLETED', CANCELLED = 'CANCELLED' }
export enum FulfillmentType { PICKUP = 'PICKUP', DELIVERY = 'DELIVERY' }
export enum BannerTargetType { NONE = 'NONE', PRODUCT = 'PRODUCT', CATEGORY = 'CATEGORY' }
export enum ApiErrorCode { PHONE_REQUIRED = 'PHONE_REQUIRED', SKU_UNAVAILABLE = 'SKU_UNAVAILABLE', STOCK_INSUFFICIENT = 'STOCK_INSUFFICIENT', INVALID_ORDER_TRANSITION = 'INVALID_ORDER_TRANSITION' }
```

```ts
// packages/shared-contracts/src/order.ts
import { FulfillmentType, OrderStatus } from './enums';

export type CreateOrderRequest = {
  cartItemIds: string[];
  fulfillmentType: FulfillmentType;
  contactName: string;
  contactPhone: string;
  pickupTimeText?: string;
  addressId?: string;
  remark?: string;
};

export const canTransitionOrder = (from: OrderStatus, to: OrderStatus): boolean =>
  (from === OrderStatus.NEW && to === OrderStatus.PROCESSING) ||
  (from === OrderStatus.PROCESSING && [OrderStatus.COMPLETED, OrderStatus.CANCELLED].includes(to));
```

- [ ] **Step 4: 运行模块测试、类型检查与构建。**

Run: `pnpm --filter @bake-mall/contracts test && pnpm --filter @bake-mall/contracts typecheck && pnpm --filter @bake-mall/contracts build`

Expected: PASS，`dist/index.d.ts` 和 `dist/index.js` 生成。

- [ ] **Step 5: 提交共享契约。**

```bash
git add packages/shared-contracts pnpm-lock.yaml
git commit -m "feat: add shared mall API contracts"
```

### Task 3: 搭建 NestJS、数据库实体、迁移与健康检查

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/config/env.schema.ts`
- Create: `apps/api/src/database/data-source.ts`
- Create: `apps/api/src/database/database.module.ts`
- Create: `apps/api/src/database/entities/*.entity.ts`
- Create: `apps/api/src/database/migrations/0001-initial-schema.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/test/health.e2e-spec.ts`

**Interfaces:**
- Consumes: `@bake-mall/contracts`。
- Produces: MySQL 表 `users`, `addresses`, `categories`, `products`, `product_images`, `skus`, `cart_items`, `orders`, `order_items`, `banners`, `admin_users`, `audit_logs`, `idempotency_records`；`GET /api/v1/health` 返回 `{ "status": "ok" }`。

- [ ] **Step 1: 编写健康端点集成测试。**

```ts
it('returns a healthy API response', async () => {
  const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  expect(response.body).toEqual({ status: 'ok' });
});
```

- [ ] **Step 2: 运行健康测试确认失败。**

Run: `pnpm --filter @bake-mall/api test:e2e -- health.e2e-spec.ts`

Expected: FAIL，因为 Nest 应用和路由尚未创建。

- [ ] **Step 3: 创建最小 Nest 启动、配置校验和健康控制器。**

```ts
// apps/api/src/health/health.controller.ts
@Controller('api/v1/health')
export class HealthController {
  @Get()
  getHealth() { return { status: 'ok' }; }
}
```

```ts
// apps/api/src/main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1', { exclude: ['api/v1/health'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
```

Use TypeORM migrations, `synchronize: false`, `charset: 'utf8mb4'`, and UTC timestamps. Add unique constraints for `users.phone`, `(cart_items.user_id, cart_items.sku_id)`, `(idempotency_records.user_id, idempotency_records.key)`, and `orders.order_no`.

- [ ] **Step 4: 编写并执行初始迁移。**

Run: `pnpm --filter @bake-mall/api migration:generate -- src/database/migrations/0001-initial-schema && pnpm --filter @bake-mall/api migration:run`

Expected: migration 成功创建所有领域表；数据库中不存在 `synchronize` 自动建表。

- [ ] **Step 5: 验证健康接口与迁移。**

Run: `pnpm --filter @bake-mall/api test:e2e -- health.e2e-spec.ts && pnpm --filter @bake-mall/api typecheck`

Expected: PASS。

- [ ] **Step 6: 提交数据库基础。**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat: add API database schema and health endpoint"
```

### Task 4: 实现用户、管理员认证与权限隔离

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/src/auth/user-auth.service.ts`
- Create: `apps/api/src/auth/admin-auth.service.ts`
- Create: `apps/api/src/auth/user-jwt.guard.ts`
- Create: `apps/api/src/auth/admin-jwt.guard.ts`
- Create: `apps/api/src/auth/current-user.decorator.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/admin-auth.controller.ts`
- Create: `apps/api/src/auth/dto/*.ts`
- Create: `apps/api/src/auth/auth.service.spec.ts`
- Create: `apps/api/test/auth-isolation.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /api/v1/auth/dev/send-code`, `POST /api/v1/auth/dev/login`, `POST /api/v1/auth/bind-phone`, `POST /api/v1/admin/auth/login`。
- Produces: `@CurrentUser() user: AuthenticatedUser` 和 `UserJwtGuard` / `AdminJwtGuard`。
- Security: 用户 token 的 `aud` 固定为 `mall-user`；管理员 token 的 `aud` 固定为 `mall-admin`；使用 `JWT_USER_SECRET` 与 `JWT_ADMIN_SECRET`。

- [ ] **Step 1: 编写 token 隔离失败测试。**

```ts
it('rejects a user JWT on an admin endpoint', async () => {
  const userToken = await loginAsTestUser();
  await request(app.getHttpServer())
    .get('/api/v1/admin/categories')
    .set('Authorization', `Bearer ${userToken}`)
    .expect(401);
});
```

- [ ] **Step 2: 运行隔离测试确认失败。**

Run: `pnpm --filter @bake-mall/api test:e2e -- auth-isolation.e2e-spec.ts`

Expected: FAIL，因为 token 还未区分 audience。

- [ ] **Step 3: 实现两个独立 JWT 策略及开发验证码流程。**

Implement the following fixed development behavior:

```ts
const DEVELOPMENT_CODE = '123456';

async verifyDevelopmentCode(phone: string, code: string): Promise<AuthTokens> {
  if (process.env.NODE_ENV === 'production' || code !== DEVELOPMENT_CODE) {
    throw new UnauthorizedException('Invalid verification code');
  }
  const user = await this.usersService.findOrCreateByPhone(phone);
  return this.issueUserTokens(user.id, user.phone);
}
```

`bind-phone` must require an authenticated user and write the verified phone only after the development code check. Administrator initialization reads `ADMIN_EMAIL` and `ADMIN_PASSWORD`; hash with bcrypt before storage. Do not expose password hashes in any response.

- [ ] **Step 4: 覆盖手机号下单前置条件。**

Add a unit test for `requireVerifiedPhone(user)` that throws `ForbiddenException` with `ApiErrorCode.PHONE_REQUIRED` when `phone` is null and returns the user otherwise.

- [ ] **Step 5: 运行认证完整测试。**

Run: `pnpm --filter @bake-mall/api test && pnpm --filter @bake-mall/api test:e2e -- auth-isolation.e2e-spec.ts`

Expected: PASS；用户 token 不能访问管理员端点，管理员 token 不能访问用户端点。

- [ ] **Step 6: 提交认证基础。**

```bash
git add apps/api
git commit -m "feat: add isolated user and admin authentication"
```

### Task 5: 实现后台分类、商品、SKU、COS 上传与富文本清洗 API

**Files:**
- Create: `apps/api/src/catalog/catalog.module.ts`
- Create: `apps/api/src/catalog/admin-categories.controller.ts`
- Create: `apps/api/src/catalog/admin-products.controller.ts`
- Create: `apps/api/src/catalog/public-catalog.controller.ts`
- Create: `apps/api/src/catalog/catalog.service.ts`
- Create: `apps/api/src/catalog/dto/*.ts`
- Create: `apps/api/src/upload/upload.module.ts`
- Create: `apps/api/src/upload/upload.service.ts`
- Create: `apps/api/src/upload/upload.controller.ts`
- Create: `apps/api/src/content/html-sanitizer.service.ts`
- Create: `apps/api/src/catalog/catalog.service.spec.ts`
- Create: `apps/api/test/catalog.e2e-spec.ts`

**Interfaces:**
- Produces: 管理端 `/api/v1/admin/categories`, `/api/v1/admin/products`, `/api/v1/admin/products/:id/skus`, `/api/v1/upload/presign`。
- Produces: 用户端 `GET /api/v1/public/categories`, `GET /api/v1/public/products`, `GET /api/v1/public/products/:id`。
- Produces: `sanitizeProductHtml(input: string): string`；只允许段落、标题、列表、加粗、斜体、链接和 HTTPS COS 图片。

- [ ] **Step 1: 编写富文本清洗失败测试。**

```ts
it('removes scripts, event handlers, and non-COS image URLs', () => {
  const html = '<p onclick="alert(1)">safe</p><script>alert(1)</script><img src="https://evil.test/a.png">';
  expect(sanitizeProductHtml(html)).toBe('<p>safe</p>');
});
```

- [ ] **Step 2: 编写 SKU 约束失败测试。**

```ts
it('rejects a SKU with a negative stock or non-integer price', async () => {
  await expect(service.createSku(productId, { name: '6寸', priceCents: 68.5, stock: -1 })).rejects.toThrow(BadRequestException);
});
```

- [ ] **Step 3: 运行测试确认失败。**

Run: `pnpm --filter @bake-mall/api test -- catalog.service.spec.ts`

Expected: FAIL，因为清洗器与 SKU 验证尚未实现。

- [ ] **Step 4: 实现分类、商品和 SKU 服务。**

Use `class-validator` DTO validation:

```ts
export class CreateSkuDto {
  @IsString() @MaxLength(80) name!: string;
  @IsInt() @Min(0) priceCents!: number;
  @IsInt() @Min(0) stock!: number;
  @IsOptional() @IsUrl({ protocols: ['https'] }) imageUrl?: string;
}
```

`Product` 创建或更新必须保存 `sanitizeProductHtml(dto.detailHtml)`。公开商品查询必须只返回上架商品与上架 SKU，并按 `sortOrder ASC, createdAt DESC` 排序。分类只能单层，DTO 中不得提供 parent ID。

- [ ] **Step 5: 实现受控 COS 上传签名。**

`POST /api/v1/upload/presign` 仅管理员可访问；校验 MIME 类型为 `image/jpeg`、`image/png` 或 `image/webp`，文件大小不超过 5 MiB，key 必须由服务端生成并以 `products/` 或 `banners/` 开头。开发环境通过 MinIO endpoint 配置；生产环境通过 COS endpoint 配置。

- [ ] **Step 6: 执行 API 集成测试。**

Run: `pnpm --filter @bake-mall/api test:e2e -- catalog.e2e-spec.ts`

Expected: 管理员可创建分类、带两个 SKU 的商品；公开接口不返回下架商品；恶意 HTML 不会出现在响应详情中。

- [ ] **Step 7: 提交商品域。**

```bash
git add apps/api
git commit -m "feat: add catalog SKU uploads and sanitized product content"
```

### Task 6: 实现 Banner、购物车、地址簿和用户资料 API

**Files:**
- Create: `apps/api/src/banner/banner.module.ts`
- Create: `apps/api/src/banner/banner.service.ts`
- Create: `apps/api/src/banner/admin-banner.controller.ts`
- Create: `apps/api/src/banner/public-banner.controller.ts`
- Create: `apps/api/src/customer/customer.module.ts`
- Create: `apps/api/src/customer/cart.service.ts`
- Create: `apps/api/src/customer/address.service.ts`
- Create: `apps/api/src/customer/me.controller.ts`
- Create: `apps/api/src/customer/dto/*.ts`
- Create: `apps/api/src/customer/address.service.spec.ts`
- Create: `apps/api/test/customer.e2e-spec.ts`

**Interfaces:**
- Produces: `/api/v1/me`, `/api/v1/me/cart/items`, `/api/v1/me/addresses` 和公开 `/api/v1/public/banners`。
- Invariants: 每用户至多一个 `isDefault = true` 地址；新增/设默认地址必须在事务内取消该用户其余默认标记。

- [ ] **Step 1: 编写默认地址互斥失败测试。**

```ts
it('keeps exactly one default address per user', async () => {
  await service.create(userId, { receiverName: 'A', phone: '13800000000', province: 'Zhejiang', city: 'Hangzhou', district: 'Xihu', detail: 'No. 1', isDefault: true });
  const second = await service.create(userId, { receiverName: 'B', phone: '13900000000', province: 'Zhejiang', city: 'Hangzhou', district: 'Xihu', detail: 'No. 2', isDefault: true });
  expect((await service.list(userId)).filter((address) => address.isDefault)).toEqual([expect.objectContaining({ id: second.id })]);
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `pnpm --filter @bake-mall/api test -- address.service.spec.ts`

Expected: FAIL，因为地址服务尚未实现。

- [ ] **Step 3: 实现地址、购物车和我的资料端点。**

Cart `POST /me/cart/items` 接收 `{ skuId, quantity }`；同一用户同一 SKU 使用唯一键 upsert；`quantity` 必须为 1–99。购物车读取返回商品、SKU、实时单价、库存和 `available`，但不得承诺它可以直接成交。用户资料响应只返回头像、昵称和掩码后的手机号。

- [ ] **Step 4: 实现 Banner 目标校验。**

创建或更新 Banner 时，`targetType = PRODUCT` 需验证目标商品存在；`CATEGORY` 需验证分类存在；`NONE` 必须为 `targetId = null`。公开接口只返回 `enabled = true` 且目标仍有效的 Banner。

- [ ] **Step 5: 运行客户域端到端测试。**

Run: `pnpm --filter @bake-mall/api test:e2e -- customer.e2e-spec.ts`

Expected: 地址默认项互斥；购物车同 SKU 合并数量；公开 Banner 过滤下架或失效跳转。

- [ ] **Step 6: 提交用户辅助域。**

```bash
git add apps/api
git commit -m "feat: add banners carts addresses and customer profile APIs"
```

### Task 7: 实现事务订单、库存并发、幂等键和后台审计

**Files:**
- Create: `apps/api/src/orders/orders.module.ts`
- Create: `apps/api/src/orders/orders.service.ts`
- Create: `apps/api/src/orders/orders.controller.ts`
- Create: `apps/api/src/orders/admin-orders.controller.ts`
- Create: `apps/api/src/orders/dto/create-order.dto.ts`
- Create: `apps/api/src/orders/dto/update-order-status.dto.ts`
- Create: `apps/api/src/audit/audit.service.ts`
- Create: `apps/api/src/orders/orders.service.spec.ts`
- Create: `apps/api/test/orders.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /api/v1/orders`，请求头 `Idempotency-Key` 必填；`GET /api/v1/me/orders`；`GET /api/v1/admin/orders`；`PATCH /api/v1/admin/orders/:id/status`。
- Produces: `OrdersService.create(userId: string, idempotencyKey: string, dto: CreateOrderDto): Promise<OrderView>`。
- Invariants: 商品、SKU、价格、数量、图片、联系人、地址或取货文本均写入订单快照；订单总额等于订单项 `unitPriceCents * quantity` 之和。

- [ ] **Step 1: 编写库存不足回滚失败测试。**

```ts
it('rolls back every SKU decrement when one cart item has insufficient stock', async () => {
  await seedCart(userId, [{ skuId: skuA.id, quantity: 1 }, { skuId: skuB.id, quantity: 2 }]);
  await setStock(skuA.id, 1);
  await setStock(skuB.id, 1);
  await expect(createOrder(userId, 'key-a')).rejects.toMatchObject({ code: ApiErrorCode.STOCK_INSUFFICIENT });
  expect(await stockOf(skuA.id)).toBe(1);
  expect(await stockOf(skuB.id)).toBe(1);
});
```

- [ ] **Step 2: 编写重复幂等键失败测试。**

```ts
it('returns the original order and decrements inventory only once for the same key', async () => {
  const first = await createOrder(userId, 'stable-key');
  const second = await createOrder(userId, 'stable-key');
  expect(second.id).toBe(first.id);
  expect(await stockOf(skuId)).toBe(initialStock - 1);
});
```

- [ ] **Step 3: 运行订单测试确认失败。**

Run: `pnpm --filter @bake-mall/api test -- orders.service.spec.ts`

Expected: FAIL，因为下单服务未实现。

- [ ] **Step 4: 实现事务下单。**

Use a `QueryRunner` transaction. For each selected cart item execute exactly this shape of conditional update and fail if `affected !== 1`:

```ts
const result = await manager
  .createQueryBuilder()
  .update(SkuEntity)
  .set({ stock: () => 'stock - :quantity' })
  .where('id = :skuId AND stock >= :quantity AND enabled = true', { skuId, quantity })
  .execute();
```

Before inventory writes, atomically reserve the idempotency key for the user. If the unique key already exists with an `orderId`, return that order. If another request holds an incomplete key, return `409` and let the client retry with the same key. Create a cryptographically unique `orderNo` such as `BM${YYYYMMDD}${random 8 digits}` and enforce its database unique index.

- [ ] **Step 5: 实现履约快照与状态保护。**

`PICKUP` 必须带非空 `pickupTimeText`；`DELIVERY` 必须带属于当前用户的 `addressId`。复制地址到 `deliveryAddressSnapshot` JSON；同时复制订单联系人和手机号。后台状态更新必须调用 `canTransitionOrder`; 状态不合法时返回 `422` + `INVALID_ORDER_TRANSITION`。当目标是 `CANCELLED` 时写审计日志并返回“不回补库存”的提示字段。

- [ ] **Step 6: 增加并发库存集成测试。**

Create two different users whose cart each requests the final single unit. Execute `Promise.allSettled([createOrder(userA, 'a'), createOrder(userB, 'b')])`; assert exactly one is fulfilled, final stock is `0`, and only one order exists.

- [ ] **Step 7: 运行订单全套测试。**

Run: `pnpm --filter @bake-mall/api test && pnpm --filter @bake-mall/api test:e2e -- orders.e2e-spec.ts`

Expected: PASS；无负库存、无重复订单、历史快照不随商品/地址更新改变。

- [ ] **Step 8: 提交订单闭环。**

```bash
git add apps/api
git commit -m "feat: add transactional idempotent order creation"
```

### Task 8: 创建 H5 SPA 基础、Vant 主题、路由与认证状态

**Files:**
- Create: `apps/h5-store/package.json`
- Create: `apps/h5-store/vite.config.ts`
- Create: `apps/h5-store/src/main.ts`
- Create: `apps/h5-store/src/App.vue`
- Create: `apps/h5-store/src/router/index.ts`
- Create: `apps/h5-store/src/styles/theme.css`
- Create: `apps/h5-store/src/api/http.ts`
- Create: `apps/h5-store/src/stores/auth.ts`
- Create: `apps/h5-store/src/bridge/miniapp.ts`
- Create: `apps/h5-store/src/views/LoginView.vue`
- Create: `apps/h5-store/src/views/NotFoundView.vue`
- Create: `apps/h5-store/src/stores/auth.spec.ts`

**Interfaces:**
- Consumes: `/auth/dev/login`, future WeChat bridge payload `{ type: 'WECHAT_CODE', code: string }` and `{ type: 'PHONE_CREDENTIAL', credential: string }`。
- Produces: Pinia store `useAuthStore()` with `accessToken`, `profile`, `loginWithDevelopmentCode(phone, code)`, `requireVerifiedPhone(redirectPath)`。

- [ ] **Step 1: 写入 Pinia 认证守卫失败测试。**

```ts
it('returns the requested path when a verified phone is absent', async () => {
  const store = useAuthStore();
  store.profile = { id: 'u1', phone: null, nickname: 'Cake Fan', avatarUrl: null };
  expect(store.requireVerifiedPhone('/checkout')).toBe('/login?redirect=%2Fcheckout');
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `pnpm --filter @bake-mall/h5-store test -- auth.spec.ts`

Expected: FAIL，因为 H5 应用和认证 store 尚未创建。

- [ ] **Step 3: 创建 Vite、Vant、Pinia 与路由。**

Configure routes `/`, `/category/:id`, `/products/:id`, `/cart`, `/checkout`, `/orders`, `/orders/:id`, `/profile`, `/addresses`, `/login`. Add an HTTP interceptor that sends `Authorization: Bearer <token>`, converts API failures to a typed `ApiClientError`, and clears the user session only for `401` responses.

Use CSS variables:

```css
:root {
  --mall-cream: #fffaf3;
  --mall-leaf: #8fb58f;
  --mall-apricot: #f2c99d;
  --van-primary-color: #7da77d;
  --van-radius-lg: 16px;
}
```

- [ ] **Step 4: 实现小程序桥接侦听而不在网页环境报错。**

```ts
export function installMiniappBridge(onMessage: (message: MiniappMessage) => void): void {
  window.addEventListener('message', (event: MessageEvent<MiniappMessage>) => {
    if (event.data?.source === 'bake-miniapp') onMessage(event.data);
  });
}
```

Provide a development-only login panel with `13800000000 / 123456`; production builds must hide the fixed verification code hint.

- [ ] **Step 5: 运行 H5 单元测试与构建。**

Run: `pnpm --filter @bake-mall/h5-store test && pnpm --filter @bake-mall/h5-store build`

Expected: PASS，生成静态 SPA 产物。

- [ ] **Step 6: 提交 H5 应用外壳。**

```bash
git add apps/h5-store pnpm-lock.yaml
git commit -m "feat: add mobile storefront application shell"
```

### Task 9: 实现 H5 首页、分类、搜索、商品详情、SKU 与购物车

**Files:**
- Create: `apps/h5-store/src/api/catalog.ts`
- Create: `apps/h5-store/src/api/customer.ts`
- Create: `apps/h5-store/src/stores/cart.ts`
- Create: `apps/h5-store/src/components/ProductCard.vue`
- Create: `apps/h5-store/src/components/SkuPicker.vue`
- Create: `apps/h5-store/src/views/HomeView.vue`
- Create: `apps/h5-store/src/views/CategoryView.vue`
- Create: `apps/h5-store/src/views/ProductDetailView.vue`
- Create: `apps/h5-store/src/views/CartView.vue`
- Create: `apps/h5-store/src/components/SkuPicker.spec.ts`
- Create: `apps/h5-store/src/stores/cart.spec.ts`

**Interfaces:**
- Consumes: `/public/banners`, `/public/categories`, `/public/products`, `/public/products/:id`, `/me/cart/items`。
- Produces: `SkuPicker` emits `{ skuId: string; quantity: number }` only for enabled and in-stock SKU。

- [ ] **Step 1: 编写不可售 SKU 失败测试。**

```ts
it('does not emit add when the chosen SKU is disabled or empty', async () => {
  const wrapper = mount(SkuPicker, { props: { skus: [{ id: 's1', name: '6寸', stock: 0, enabled: true, priceCents: 6800 }] } });
  await wrapper.get('[data-testid="sku-s1"]').trigger('click');
  await wrapper.get('[data-testid="add-cart"]').trigger('click');
  expect(wrapper.emitted('add')).toBeUndefined();
});
```

- [ ] **Step 2: 运行组件测试确认失败。**

Run: `pnpm --filter @bake-mall/h5-store test -- SkuPicker.spec.ts`

Expected: FAIL，因为 SKU 组件尚未实现。

- [ ] **Step 3: 实现商品发现页面。**

HomeView 按以下固定顺序渲染：可用 Banner、单层分类入口、人气商品双列流、未来场景专区占位（不请求或实现运营配置）、底部导航。CategoryView 使用产品名称关键字 `q` 和分类 id 查询。ProductDetailView 使用 Vant `ActionSheet` 承载 SKU 选择并通过 `v-html` 渲染服务端清洗后的详情 HTML，不在客户端二次解析或执行脚本。

- [ ] **Step 4: 实现购物车 store 与页面状态。**

`useCartStore().refresh()` 获取实时购物车，`setQuantity(id, quantity)` 限制 1–99，`remove(id)` 删除。CartView 对 `available = false` 项显示“已失效”，禁止该项结算；商品金额只显示 `priceCents × quantity`，不展示运费、优惠或支付字段。

- [ ] **Step 5: 运行前端测试和静态检查。**

Run: `pnpm --filter @bake-mall/h5-store test && pnpm --filter @bake-mall/h5-store typecheck && pnpm --filter @bake-mall/h5-store lint`

Expected: PASS。

- [ ] **Step 6: 提交商品浏览与购物车。**

```bash
git add apps/h5-store
git commit -m "feat: add storefront catalog SKU selection and cart"
```

### Task 10: 实现 H5 结算、订单、地址簿与个人资料

**Files:**
- Create: `apps/h5-store/src/api/orders.ts`
- Create: `apps/h5-store/src/views/CheckoutView.vue`
- Create: `apps/h5-store/src/views/OrdersView.vue`
- Create: `apps/h5-store/src/views/OrderDetailView.vue`
- Create: `apps/h5-store/src/views/AddressesView.vue`
- Create: `apps/h5-store/src/views/ProfileView.vue`
- Create: `apps/h5-store/src/components/AddressForm.vue`
- Create: `apps/h5-store/src/views/CheckoutView.spec.ts`

**Interfaces:**
- Consumes: `/orders`, `/me/orders`, `/me/addresses`, `/me`。
- Produces: checkout 提交请求头的唯一 `Idempotency-Key`；同一次提交重试复用相同 key，成功后才生成新 key。

- [ ] **Step 1: 编写自提和配送表单失败测试。**

```ts
it('requires pickup time for pickup and an address for delivery', async () => {
  const wrapper = mount(CheckoutView, { global: { plugins: [pinia] } });
  await wrapper.get('[data-testid="fulfillment-pickup"]').trigger('click');
  await wrapper.get('form').trigger('submit');
  expect(wrapper.text()).toContain('请填写期望取货时间');
  await wrapper.get('[data-testid="fulfillment-delivery"]').trigger('click');
  await wrapper.get('form').trigger('submit');
  expect(wrapper.text()).toContain('请选择配送地址');
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `pnpm --filter @bake-mall/h5-store test -- CheckoutView.spec.ts`

Expected: FAIL，因为结算页面尚未实现。

- [ ] **Step 3: 实现结算与幂等提交。**

结算进入时调用 `auth.requireVerifiedPhone('/checkout')`。渲染两项履约选项：

- `PICKUP`：联系人、手机号、必填自由文本“期望取货时间”。
- `DELIVERY`：联系人、手机号、必选地址簿项；明确显示“配送时间由商家联系确认”。

订单备注可选，最大 300 字。提交时禁用按钮、发送稳定 idempotency key；若网络失败，保留 key 与表单，以便重试不会重复下单。成功后清空该 key，刷新购物车，跳转 `/orders/:id`。

- [ ] **Step 4: 实现订单、地址簿和资料页。**

OrdersView 根据 `NEW/PROCESSING/COMPLETED/CANCELLED` 显示明确中文状态标签。OrderDetailView 只展示快照字段，不读取实时商品替代历史字段。AddressForm 校验联系人、11 位手机号、省市区与详细地址，默认地址开关调用服务端。ProfileView 展示用户资料与掩码手机号，未绑定时引导到登录/绑定页。

- [ ] **Step 5: 运行 H5 完整测试。**

Run: `pnpm --filter @bake-mall/h5-store test && pnpm --filter @bake-mall/h5-store build`

Expected: PASS。

- [ ] **Step 6: 提交顾客下单体验。**

```bash
git add apps/h5-store
git commit -m "feat: add checkout orders addresses and profile"
```

### Task 11: 创建 PC 后台 SPA、Element Plus 主题与管理员认证

**Files:**
- Create: `apps/admin-web/package.json`
- Create: `apps/admin-web/vite.config.ts`
- Create: `apps/admin-web/src/main.ts`
- Create: `apps/admin-web/src/App.vue`
- Create: `apps/admin-web/src/router/index.ts`
- Create: `apps/admin-web/src/api/http.ts`
- Create: `apps/admin-web/src/stores/admin-auth.ts`
- Create: `apps/admin-web/src/layouts/AdminLayout.vue`
- Create: `apps/admin-web/src/styles/theme.css`
- Create: `apps/admin-web/src/views/LoginView.vue`
- Create: `apps/admin-web/src/views/DashboardView.vue`
- Create: `apps/admin-web/src/stores/admin-auth.spec.ts`

**Interfaces:**
- Consumes: `POST /admin/auth/login`。
- Produces: `/dashboard`, `/categories`, `/products`, `/banners`, `/orders` 路由，管理员 token 拦截器与路由守卫。

- [ ] **Step 1: 编写后台未登录路由守卫失败测试。**

```ts
it('redirects an unauthenticated administrator to login', async () => {
  await router.push('/products');
  await router.isReady();
  expect(router.currentRoute.value.fullPath).toBe('/login?redirect=/products');
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `pnpm --filter @bake-mall/admin-web test -- admin-auth.spec.ts`

Expected: FAIL，因为后台工程尚未创建。

- [ ] **Step 3: 实现后台基础布局与视觉 tokens。**

Use Element Plus. Theme variables:

```css
:root {
  --el-color-primary: #7b61c8;
  --el-color-success: #66a786;
  --admin-pink: #ff8bb2;
  --admin-lilac: #f4efff;
  --el-border-radius-base: 10px;
}
```

AdminLayout 必须含固定侧栏（概览、商品、分类、Banner、订单）、顶部管理员菜单、主内容区和移动窄屏提示。插画只用于 dashboard 和空状态；数据表格与弹窗不使用干扰性动画。

- [ ] **Step 4: 实现管理员登录和 HTTP 隔离。**

使用 `adminToken` 单独存入 sessionStorage 键 `bake_admin_token`，绝不读取 H5 用户 token。401 时清空管理员状态并回到登录页。登录密码输入框自动完成属性使用 `current-password`。

- [ ] **Step 5: 运行后台基础测试与构建。**

Run: `pnpm --filter @bake-mall/admin-web test && pnpm --filter @bake-mall/admin-web build`

Expected: PASS。

- [ ] **Step 6: 提交后台应用外壳。**

```bash
git add apps/admin-web pnpm-lock.yaml
git commit -m "feat: add merchant admin application shell"
```

### Task 12: 实现后台分类、商品/SKU、图片、Banner 与订单管理界面

**Files:**
- Create: `apps/admin-web/src/api/catalog.ts`
- Create: `apps/admin-web/src/api/orders.ts`
- Create: `apps/admin-web/src/api/upload.ts`
- Create: `apps/admin-web/src/views/CategoriesView.vue`
- Create: `apps/admin-web/src/views/ProductsView.vue`
- Create: `apps/admin-web/src/views/ProductEditorView.vue`
- Create: `apps/admin-web/src/components/SkuTableEditor.vue`
- Create: `apps/admin-web/src/components/RichTextEditor.vue`
- Create: `apps/admin-web/src/components/CosImageUploader.vue`
- Create: `apps/admin-web/src/views/BannersView.vue`
- Create: `apps/admin-web/src/views/OrdersView.vue`
- Create: `apps/admin-web/src/views/OrderDetailView.vue`
- Create: `apps/admin-web/src/components/SkuTableEditor.spec.ts`
- Create: `apps/admin-web/src/views/OrderDetailView.spec.ts`

**Interfaces:**
- Consumes: 后台 catalog、banner、upload、order API。
- Produces: SKU 编辑器输出 `Array<{ id?: string; name: string; priceCents: number; stock: number; enabled: boolean; imageUrl?: string }>`；后台订单 UI 只调用状态更新接口，不发送订单内容编辑请求。

- [ ] **Step 1: 编写 SKU 金额/库存编辑失败测试。**

```ts
it('converts yuan input to integer cents and blocks negative stock', async () => {
  const wrapper = mount(SkuTableEditor, { props: { modelValue: [] } });
  await wrapper.get('[data-testid="add-sku"]').trigger('click');
  await wrapper.get('[data-testid="price-0"]').setValue('68.50');
  await wrapper.get('[data-testid="stock-0"]').setValue('-1');
  expect(wrapper.text()).toContain('库存不能小于 0');
  expect(wrapper.emitted('update:modelValue')).toBeUndefined();
});
```

- [ ] **Step 2: 编写订单状态操作失败测试。**

```ts
it('shows only legal actions for a NEW order', () => {
  const wrapper = mount(OrderDetailView, { props: { order: { status: 'NEW' } } });
  expect(wrapper.text()).toContain('开始处理');
  expect(wrapper.text()).not.toContain('完成订单');
  expect(wrapper.text()).not.toContain('取消订单');
});
```

- [ ] **Step 3: 运行测试确认失败。**

Run: `pnpm --filter @bake-mall/admin-web test -- SkuTableEditor.spec.ts OrderDetailView.spec.ts`

Expected: FAIL，因为组件尚未实现。

- [ ] **Step 4: 实现分类、商品与富文本编辑。**

CategoriesView 仅有单层分类字段。ProductEditor 使用富文本编辑器输出 HTML，但在预览区显示服务端保存后的 HTML。SKU 编辑器将元输入转换为 `Math.round(Number(yuan) * 100)`，拒绝非两位小数以外的精度与负数；至少一个 SKU 才允许保存商品。上架商品至少应有一个上架且库存非负 SKU。

- [ ] **Step 5: 实现 COS 直传和 Banner 管理。**

CosImageUploader 先请求 `/upload/presign`，后用返回的表单/签名上传文件，最后把服务器确认的 `objectKey` 和 `url` 写回表单。限制 JPEG、PNG、WebP 和 5 MiB；失败时保留已填商品数据。Banner 编辑器只允许无跳转、有效商品或有效分类三种目标。

- [ ] **Step 6: 实现订单只读详情与状态流转。**

OrdersView 提供订单号、状态、履约方式和日期筛选。OrderDetail 展示商品和履约快照；不提供商品、地址、价格或数量编辑控件。`NEW` 只显示“开始处理”，`PROCESSING` 显示“完成订单”和“取消订单”，终态不显示操作按钮。取消确认弹窗必须明确写“取消订单不会回补库存”。

- [ ] **Step 7: 运行后台完整测试。**

Run: `pnpm --filter @bake-mall/admin-web test && pnpm --filter @bake-mall/admin-web typecheck && pnpm --filter @bake-mall/admin-web build`

Expected: PASS。

- [ ] **Step 8: 提交商家管理界面。**

```bash
git add apps/admin-web
git commit -m "feat: add merchant catalog banner and order management"
```

### Task 13: 创建原生微信小程序 H5 容器与桥接协议

**Files:**
- Create: `apps/miniapp-shell/project.config.json`
- Create: `apps/miniapp-shell/app.json`
- Create: `apps/miniapp-shell/app.ts`
- Create: `apps/miniapp-shell/pages/index/index.wxml`
- Create: `apps/miniapp-shell/pages/index/index.ts`
- Create: `apps/miniapp-shell/pages/index/index.json`
- Create: `apps/miniapp-shell/utils/bridge.ts`
- Create: `apps/miniapp-shell/utils/bridge.spec.ts`
- Create: `docs/runbook/wechat-miniapp-setup.md`

**Interfaces:**
- Produces: 小程序 `web-view` 入口；向 H5 postMessage 的统一结构 `{ source: 'bake-miniapp', type: 'WECHAT_CODE' | 'PHONE_CREDENTIAL', code?: string, credential?: string }`。
- Constraint: H5 URL 由 `MINIAPP_H5_URL` 构建时配置，必须使用 HTTPS 且不得由用户输入控制。

- [ ] **Step 1: 编写桥接消息失败测试。**

```ts
it('builds an explicit namespaced WeChat code message', () => {
  expect(makeWechatCodeMessage('code-1')).toEqual({ source: 'bake-miniapp', type: 'WECHAT_CODE', code: 'code-1' });
});
```

- [ ] **Step 2: 运行测试确认失败。**

Run: `pnpm --filter @bake-mall/miniapp-shell test -- bridge.spec.ts`

Expected: FAIL，因为桥接工具尚未存在。

- [ ] **Step 3: 实现 web-view 与登录桥接。**

Index 页面将 HTTPS H5 URL 作为 `web-view` 的 `src`。页面加载后调用 `wx.login()`，通过 `webViewContext.postMessage` 发送 code。接收 H5 消息时只响应白名单 action `REQUEST_PHONE_CREDENTIAL`；使用 `getPhoneNumber` 事件获得 credential，再经 `postMessage` 发送。不要在小程序存储商城 JWT；所有会话仍由 H5 与后端持有。

- [ ] **Step 4: 编写微信配置运行手册。**

`docs/runbook/wechat-miniapp-setup.md` 必须逐项列出：

1. H5、API、COS/CDN 域名均使用 HTTPS；
2. 在微信公众平台填写 request 合法域名、uploadFile 合法域名、downloadFile 合法域名和业务域名；
3. 将 H5 域名加入 `web-view` 业务域名；
4. 配置正式 AppID、AppSecret 和服务器 code 换取 session 的环境变量；
5. 真机验证 `wx.login`、手机号授权和 H5 页面恢复。

- [ ] **Step 5: 运行桥接工具测试。**

Run: `pnpm --filter @bake-mall/miniapp-shell test && pnpm --filter @bake-mall/miniapp-shell typecheck`

Expected: PASS。

- [ ] **Step 6: 提交小程序容器。**

```bash
git add apps/miniapp-shell docs/runbook/wechat-miniapp-setup.md
git commit -m "feat: add miniapp webview authentication bridge"
```

### Task 14: 补齐生产配置、端到端测试、容器化和运行手册

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `apps/api/.dockerignore`
- Create: `infra/nginx.conf`
- Create: `infra/api.Dockerfile`
- Create: `tests/e2e/mall-flow.spec.ts`
- Create: `playwright.config.ts`
- Create: `docs/runbook/local-development.md`
- Create: `docs/runbook/deployment.md`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: 已完成 API、H5、后台、MySQL/MinIO 和小程序容器。
- Produces: 一条可重复的本地启动路径和端到端验收流程；生产环境变量清单。

- [ ] **Step 1: 编写失败的浏览器端到端流程。**

```ts
test('merchant publishes a SKU and customer orders it for pickup', async ({ browser }) => {
  const admin = await browser.newPage();
  await admin.goto(process.env.ADMIN_URL!);
  await admin.getByLabel('账号').fill('admin@example.test');
  await admin.getByLabel('密码').fill('admin-password');
  await admin.getByRole('button', { name: '登录' }).click();
  await admin.getByRole('link', { name: '商品' }).click();
  // Create category, product and SKU with stock 2 through visible form controls.

  const shopper = await browser.newPage();
  await shopper.goto(process.env.H5_URL!);
  await shopper.getByText('草莓奶油蛋糕').click();
  await shopper.getByRole('button', { name: '加入购物车' }).click();
  await shopper.getByRole('link', { name: '购物车' }).click();
  await shopper.getByRole('button', { name: '去结算' }).click();
  await shopper.getByLabel('手机号').fill('13800000000');
  await shopper.getByLabel('验证码').fill('123456');
  await shopper.getByRole('button', { name: '登录' }).click();
  await shopper.getByText('到店自提').click();
  await shopper.getByLabel('期望取货时间').fill('明天上午十点');
  await shopper.getByRole('button', { name: '提交订单' }).click();
  await expect(shopper.getByText('新订单')).toBeVisible();
});
```

- [ ] **Step 2: 运行端到端测试确认失败。**

Run: `pnpm exec playwright test tests/e2e/mall-flow.spec.ts`

Expected: FAIL，直到本地环境和业务页面全部完成。

- [ ] **Step 3: 编写 Docker 与 Nginx 配置。**

API Dockerfile 使用 Node 22 Alpine，多阶段构建，运行时用户非 root，`HEALTHCHECK` 请求 `/api/v1/health`。Nginx 对 H5/后台采用 `try_files $uri $uri/ /index.html`，`/api/` 反向代理 API 并保留 `X-Request-Id`。

- [ ] **Step 4: 写入本地与生产运行手册。**

`docs/runbook/local-development.md` 给出精确顺序：

```bash
cp .env.example .env
pnpm install
docker compose -f infra/docker-compose.dev.yml up -d
pnpm --filter @bake-mall/api migration:run
pnpm dev
```

文件必须列出开发管理员账号、验证码仅在非生产环境为 `123456`、MinIO 控制台地址和停止命令。

`docs/runbook/deployment.md` 必须列出必填变量：`DATABASE_URL`、`JWT_USER_SECRET`、`JWT_ADMIN_SECRET`、`ADMIN_EMAIL`、`ADMIN_PASSWORD`、`COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION`、`COS_PUBLIC_BASE_URL`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`H5_PUBLIC_URL`。明确禁止提交真实密钥。

- [ ] **Step 5: 启动所有服务并执行验收。**

Run:

```bash
docker compose -f infra/docker-compose.dev.yml up -d
pnpm --filter @bake-mall/api migration:run
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test
```

Expected: 全部退出码为 0；Playwright 通过商品创建、购物车、自提下单和后台状态处理流程。

- [ ] **Step 6: 提交部署与最终验收资产。**

```bash
git add apps/api/Dockerfile apps/api/.dockerignore infra/nginx.conf infra/api.Dockerfile tests/e2e playwright.config.ts docs/runbook .env.example README.md
git commit -m "docs: add deployment runbook and end-to-end verification"
```

## Plan Self-Review

### Spec coverage

| 规格要求 | 对应任务 |
|---|---|
| pnpm Monorepo、SPA、无 SSR | Task 1、Task 8、Task 11 |
| H5/Vant 小清新与后台/Element Plus 轻二次元 | Task 8–12 |
| 单管理员、双会话隔离、模拟验证码 | Task 4、Task 8、Task 11 |
| 分类、商品、多 SKU、图片、富文本安全 | Task 5、Task 9、Task 12 |
| Banner、购物车、地址簿、个人资料 | Task 6、Task 9–10、Task 12 |
| 自提/配送、订单快照、状态流转 | Task 7、Task 10、Task 12 |
| 原子库存扣减、幂等和并发测试 | Task 7 |
| COS、审计、错误契约 | Task 5、Task 7、Task 12 |
| 小程序 web-view 与微信桥接 | Task 13 |
| Docker、环境隔离、E2E、微信/COS 文档 | Task 14 |

### Placeholder scan

已检查并确认：计划没有未决占位内容；每个实现任务均给出文件范围、依赖接口、失败测试、命令和提交点。

### Type consistency

- `OrderStatus` 与 `canTransitionOrder` 在 Task 2 定义，Task 7 和 Task 12 仅消费。
- `CreateOrderRequest` 的 `fulfillmentType`、`pickupTimeText`、`addressId`、联系人与备注字段在 Task 2 定义，Task 7 API 与 Task 10 表单保持一致。
- 金额字段统一使用 `priceCents`、`unitPriceCents` 和 `goodsTotalCents`，不混用元单位。
- 小程序 bridge 的 `source`、`type`、`code` 和 `credential` 字段在 Task 8 与 Task 13 一致。
