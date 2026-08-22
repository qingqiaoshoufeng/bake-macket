# 生产部署

生产部署由外层入口负责公网暴露与 TLS。API 容器和示例 Nginx 只接收内部 HTTP；浏览器、小程序、API 与对象存储公开地址都必须使用 HTTPS。真实密钥、数据库 URL、管理员密码、COS 凭据或微信 AppSecret 只能由部署平台密钥管理服务注入。

## API 必填变量

API 实际读取并在生产启动时校验：

| 变量                                                      | 用途                                                  |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `NODE_ENV=production`                                     | 启用生产校验                                          |
| `HOST` / `PORT`                                           | API 监听地址和端口                                    |
| `DATABASE_URL`                                            | MySQL 连接串                                          |
| `JWT_USER_SECRET` / `JWT_ADMIN_SECRET`                    | 两个不同 audience 的 JWT 密钥                         |
| `JWT_EXPIRES_IN_SECONDS`                                  | JWT 生命周期                                          |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD`                          | 初始管理员                                            |
| `ORDER_QUOTE_TOKEN_SECRET` / `ORDER_QUOTE_TTL_SECONDS`    | 报价令牌                                              |
| `SIMULATED_PAYMENT_ENABLED=false`                         | 生产禁用模拟支付                                      |
| `OBJECT_STORAGE_ENDPOINT`                                 | API 内部读取 COS/S3 的 HTTPS endpoint                 |
| `OBJECT_STORAGE_CLIENT_ENDPOINT`                          | 可选；浏览器/小程序可达的稳定 HTTPS 上传签名 endpoint |
| `OBJECT_STORAGE_REGION` / `OBJECT_STORAGE_BUCKET`         | 对象存储位置                                          |
| `OBJECT_STORAGE_PUBLIC_BASE_URL`                          | COS/CDN HTTPS 公开地址                                |
| `OBJECT_STORAGE_ACCESS_KEY` / `OBJECT_STORAGE_SECRET_KEY` | 服务端对象存储凭据                                    |
| `OBJECT_STORAGE_FORCE_PATH_STYLE=false`                   | COS 通常关闭 path-style                               |
| `PRODUCT_MEDIA_ALLOWED_ORIGINS`                           | 允许的媒体 HTTPS origin，逗号分隔                     |

腾讯云控制台中的 `COS_SECRET_ID`、`COS_SECRET_KEY`、bucket、region 等名称须在部署平台映射为上面的 `OBJECT_STORAGE_*`；它们不是 API 直接读取的别名。可提交模板见根目录 `.env.production.example`。

## 构建、迁移与 API 镜像

两个兼容 Dockerfile 内容保持一致，均以仓库根作为 context，并依赖根 `.dockerignore` 防止 `.git`、依赖/构建产物、Playwright 报告和实际 `.env*` 进入 context：

```bash
docker build -f apps/api/Dockerfile -t bake-mall-api:latest .
docker build -f infra/api.Dockerfile -t bake-mall-api:compat .
```

镜像为固定 Node 22 patch/Alpine tag 的多阶段构建。runtime 只包含编译产物和 production deploy 依赖，以非 root `bake` 用户运行，不含 Vitest、Playwright、TypeScript、ts-node 或 Nest CLI。

发布 API 前使用同一个镜像执行已编译 migration 入口：

```bash
docker run --rm --env-file /secure/path/api.env bake-mall-api:latest \
  npm run migration:run:prod
```

迁移入口执行 `initialize → runMigrations → finally destroy`，失败退出非零。先备份 MySQL；禁止 `synchronize` 或 API 启动时隐式迁移。

## 云打印 payload 180 天清理

打印小票 payload 可能包含收件人姓名、掩码手机号、地址、备注和商品明细。生产环境必须由外部 cron 或 Kubernetes CronJob 每日调用 API 镜像中的清理入口，应用本身不得增加后台打印消费者：

```bash
docker run --rm --env-file /secure/path/api.env bake-mall-api:latest \
  npm run printing:retention -- --cutoff-days 180 --batch-size 500
```

命令按 `created_at,id` 稳定扫描一个有限批次，只输出 `scanned` 与 `redacted` 计数。若 `scanned` 等于 `batch-size`，调度器应继续启动下一次有限批次，直到 `scanned` 小于批次上限；失败时保持非零退出并由平台告警、重试。清理覆盖所有打印状态，包括 `UNKNOWN` 与 `MANUAL_REVIEW`，但保留订单/设备/管理员内部 ID、状态、整数分汇总、原 `payloadHash` 和审计链。

数据库备份、只读副本、导出、日志归档和故障快照必须采用同样的 180 天 PII 上限；不能仅清理主库后无限期保留旧 payload。恢复历史备份到隔离环境后，应在开放任何访问前立即执行相同 cutoff 清理，并记录清理时间、`scanned`/`redacted` 计数及备份销毁时间。不得把原 payload、完整手机号、地址、完整打印机 SN、操作密码、签名或 UserKEY 写入调度日志。

### 0011 身份迁移紧急回滚

> 兼容提示：源文件编号已顺延为 `0011-user-admin-identity.ts`，但 migrations 表中的已执行 name 仍固定为 `UserAdminIdentity1718000000009`。不得修改 migration class/name。

这是**破坏性 emergency rollback**，会删除 0011 引入的身份字段、约束、固定容量 `admin_login_verification_buckets` 表及 `wechat_credential_uses` 表。仅当数据库备份已经完成，并通过下述只读检查确认没有新身份域数据时使用。常规发布、临时故障处理或仍需保留新身份数据时不得执行。

公开管理员登录把规范化标识经带 secret 的 HMAC 映射到预置的 1024 个 bucket，只在 bucket 行保存失败窗口与 `FAILED` / `RATE_LIMITED` / `VERIFIED` 聚合总数；不保存原始标识、密码或逐次 `ADMIN_PASSWORD_VERIFICATION` AuditLog。该 action 仅用于改密、高风险操作等非公开精确验证审计。因此运维观察公开登录应读取 bucket 的聚合计数，不应期待逐次审计明细。

`BAKE_MALL_MAINTENANCE_MODE=1` 与 `BAKE_MALL_IDENTITY_WRITERS_STOPPED=1` 都只是操作者确认，不会自动切换维护模式或停止进程。后者只可在已经停止 API、worker、cron/定时任务及所有可能写入 `users`、`admin_users`、`admin_login_verification_buckets`、`audit_logs`、`wechat_credential_uses` 的 writer 后设置。0011 获取的 MySQL `GET_LOCK`/advisory lock **仅串行 migration rollback，不阻止普通业务 writer**；任何 writer 尚未停止时都不得设置该变量或开始回滚。

按以下顺序操作：

1. 在 load balancer/Ingress 上阻止 H5、Admin、小程序及内部调用方的新入口流量，并保持维护响应；不要只停止对外 DNS。
2. 使用部署平台的停止/缩容能力停止全部 API、worker 和 cron/定时任务。本仓库没有生产编排停止脚本，不得把开发命令 `pnpm services:down` 当作生产停写。使用平台的进程或容器列表命令确认相关实例数为 0；例如 Docker 部署可执行 `docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'`，按实际名称和镜像确认输出中不存在 API/worker 容器。其他平台使用其等价的只读列表/状态命令，且须同时检查一次性任务和定时任务。
3. 从独立的只读 MySQL 会话先确认 migrations 表最后一条确为 `UserAdminIdentity1718000000009`，再执行下面五项 guard。查询不读取手机号、用户名、凭证 hash、审计内容等 PII；五项 guard 都必须返回 `0`：

   ```sql
   SELECT `name`, `timestamp`
   FROM `migrations`
   ORDER BY `id` DESC
   LIMIT 1;
   ```

   ```sql
   SELECT EXISTS(
     SELECT 1 FROM `admin_users`
     WHERE NOT (
       `role` <=> 'SUPER_ADMIN'
       AND `must_change_password` <=> 0
       AND `token_version` <=> 1
       AND `verify_failed_count` <=> 0
       AND `verify_window_started_at` IS NULL
       AND `last_password_changed_at` IS NULL
     )
     LIMIT 1
   ) AS `has_admin_identity_state`;

   SELECT EXISTS(
     SELECT 1 FROM `users`
     WHERE `is_active` <> 1
        OR `merged_into_user_id` IS NOT NULL
        OR `token_version` <> 1
     LIMIT 1
   ) AS `has_new_user_identity_state`;

   SELECT EXISTS(
     SELECT 1 FROM `admin_login_verification_buckets`
     WHERE `failed_count` <> 0
        OR `window_started_at` IS NOT NULL
        OR `failed_total` <> 0
        OR `limited_total` <> 0
        OR `verified_total` <> 0
        OR `first_attempt_at` IS NOT NULL
        OR `last_attempt_at` IS NOT NULL
        OR `last_result` IS NOT NULL
     LIMIT 1
   ) AS `has_admin_login_verification_bucket_state`;

   SELECT EXISTS(
     SELECT 1 FROM `wechat_credential_uses` LIMIT 1
   ) AS `has_wechat_credential_use`;

   SELECT EXISTS(
     SELECT 1 FROM `audit_logs`
     WHERE `actor_type` <> 'ADMIN' LIMIT 1
   ) AS `has_non_admin_audit_actor`;
   ```

   第一项 guard 检查完整管理员身份状态：任何非 `SUPER_ADMIN` 角色，或密码强制修改、token 版本、验证失败窗口、最近密码修改时间等安全字段偏离 0011 backfill 默认值时都会阻止回滚；`<=>` 与外层 `NOT` 确保异常 `NULL` 值也会 fail closed。它只返回是否存在阻塞行，不输出具体管理员或字段值。

   这些 SQL 以执行 down 前完整的 0011 schema 为前提；如果表或字段不存在，说明 schema 已部分回滚或状态异常，不得自行跳过查询。0011 migration 会按 checkpoint 识别状态并只查询仍存在的 guard，但人工操作必须先查明此前回滚记录和当前 schema。

4. 在流量与 writer 持续停止期间创建并校验可恢复的 MySQL 备份，记录备份位置、时间和校验结果。任何 guard 非 `0`、备份失败或状态不明都应终止操作。
5. 打开一个独立的源码 migration shell，使用与目标生产数据库对应的受控环境文件。当前生产镜像只包含编译产物和 `migration:run:prod`，不提供 revert 入口；不要在 API 容器中直接调用 migration class 的 `down()`。从已检出的同版本仓库安装锁定依赖后，运行仓库已有 TypeORM CLI 脚本：

   ```bash
   BAKE_MALL_MAINTENANCE_MODE=1 \
   BAKE_MALL_IDENTITY_WRITERS_STOPPED=1 \
   pnpm --filter @bake-mall/api migration:revert --transaction none
   ```

   `DATABASE_URL` 及生产所需配置必须由该 shell 的密钥管理环境注入，不得写进命令历史或 runbook。命令只回滚 migrations 表中的最后一条迁移；执行前必须确认最后一条确为 `UserAdminIdentity1718000000009`。`--transaction none` 与该 migration 的 `transaction = false` 及 MySQL DDL 隐式提交语义保持一致。

6. 回滚成功后，在只读 MySQL 会话执行下列 SQL，核验 migrations 最后一条已回到 0009，并核验旧 schema：`admin_login_verification_buckets` 与 `wechat_credential_uses` 的计数均为 `0`；0011 新增字段的计数为 `0`；`admin_users.username` 与 `audit_logs.admin_user_id` 两行均为 `NO`。不要查询或输出业务行内容。

   ```sql
   SELECT `name`, `timestamp`
   FROM `migrations`
   ORDER BY `id` DESC
   LIMIT 1;

   SELECT COUNT(*) AS `admin_login_verification_bucket_table_count`
   FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'admin_login_verification_buckets';

   SELECT COUNT(*) AS `wechat_table_count`
   FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'wechat_credential_uses';

   SELECT COUNT(*) AS `identity_column_count`
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND ((TABLE_NAME = 'users'
           AND COLUMN_NAME IN ('is_active', 'merged_into_user_id', 'token_version'))
       OR (TABLE_NAME = 'admin_users'
           AND COLUMN_NAME IN ('role', 'linked_user_id', 'must_change_password', 'token_version', 'verify_failed_count', 'verify_window_started_at', 'last_password_changed_at'))
       OR (TABLE_NAME = 'audit_logs'
           AND COLUMN_NAME IN ('actor_type', 'user_id')));

   SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND ((TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'username')
       OR (TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'admin_user_id'))
   ORDER BY TABLE_NAME, COLUMN_NAME;
   ```

7. 使用与旧 schema 兼容的 API 版本启动服务，先在隔离流量下用实际端口执行 `curl --fail http://127.0.0.1:<实际PORT>/api/v1/health`，再检查关键只读接口并启动所需 worker/cron。确认 health 成功、日志与数据库均无 schema 错误后才恢复入口流量。关闭 migration shell；持久化配置中的两个确认变量必须保持 `0`，不得常驻 `1`。

根 `.env.production.example` 只提供两个变量的 `0` 占位，正常 API 配置 schema 不要求它们；紧急回滚时仅在单次 migration shell 覆盖为 `1`。

### 0014 联系号与管理员登录号兼容迁移

0014 将三个手机号域拆开：`User.phone` 保留为唯一历史身份；`User.order_contact_phone` 为非唯一履约资料并带 `order_contact_phone_version`；`AdminUser.login_phone` 为唯一 OPERATOR PC 登录号。发布迁移会：

1. 将符合 11 位规则的历史 `users.phone` 回填到订单联系号并置 version 1，不修改 `phone_verified`；
2. 对 legacy OPERATOR 仅在 linked User 有合法历史身份手机号时回填 `login_phone`；无法回填者设为 inactive 并递增 token version，待 SUPER_ADMIN 重新授权；
3. 建立 loginPhone 唯一索引，并更新 SUPER_ADMIN/OPERATOR 的 `username`、`login_phone`、`linked_user_id` 角色互斥约束；
4. 在 `down` 发现任何新联系号/version、管理员 loginPhone 或 legacy 停用状态时先拒绝，再执行零 DDL，不能丢弃新域数据。

迁移前先备份并停止所有 identity/contact writer；迁移后用不输出完整手机号的聚合 SQL 检查 invalid role identity、重复 loginPhone、active OPERATOR 缺 loginPhone 等计数都为 0。不得在部署日志打印完整 `order_contact_phone` 或 `login_phone`。

`EXPOSE 3000` 只是默认端口 metadata。healthcheck 读取 `PORT`，所以改为其他容器端口时应同时设置和发布该端口，例如：

```bash
docker run --rm -e PORT=3456 -p 127.0.0.1:3456:3456 --env-file /secure/path/api.env bake-mall-api:latest
```

## 两个域名根入口与 Nginx

分别构建 H5/Admin 并挂载到：

- `/usr/share/nginx/html/h5`
- `/usr/share/nginx/html/admin`

[`infra/nginx.conf`](../../infra/nginx.conf) 定义两个内部 server：

| 公网域名示例                 | 内部端口 | 静态根目录                    |
| ---------------------------- | -------- | ----------------------------- |
| `https://mall.example.com/`  | `8080`   | `/usr/share/nginx/html/h5`    |
| `https://admin.example.com/` | `8081`   | `/usr/share/nginx/html/admin` |

外层 load balancer/Ingress 必须为两个域名终止和续签 TLS，分别将完整根路径流量转发到 8080/8081，并设置 `X-Forwarded-Proto: https`。两个 SPA 都在各自域名根路径，根 `/` 返回各自 `index.html`，history 深链 fallback 到 `/index.html`；不要配置 `/store` 或 `/admin` 子路径。该约束也保持小程序 H5 pathname 为 `/`。

两个 server 都将 `/api/` 代理到同一个 API upstream。公网客户端不可决定请求 ID：当前 Nginx 示例始终以 `$request_id` 重发 `X-Request-Id` 给 API，并通过 `add_header X-Request-Id ... always` 返回该值。受信任外层入口若需跨层关联，必须在其网络边界配置并覆盖头；本示例不直接信任或转发客户端 `X-Request-Id`。

## 生产基础设施与 TLS

开发 Compose 不是生产模板。生产应使用托管 MySQL 和 COS/S3 兼容对象存储：

1. 配置 MySQL TLS、备份/恢复演练和最小权限账号；
2. COS/CDN 与商品媒体 URL 仅使用 HTTPS；
3. H5/Admin 永不包含对象存储密钥；
4. 入口配置 WAF、访问日志、速率限制与证书自动续签。

## 微信发布门禁

将 H5、API、COS/CDN 域名登记为微信 request/uploadFile/downloadFile 与 `web-view` 业务域名。小程序构建变量必须是根路径 HTTPS URL：

```bash
MINIAPP_H5_URL=https://mall.example.com/ pnpm --filter @bake-mall/miniapp-shell build
```

API 的 `wx.login` code → `jscode2session` 链路已经实现，包含一次性凭证防重放、确定性失败快照和脱敏错误映射。发布前必须分别验收启动自动登录和 H5 显式按钮 → 同源原生页 → App 内存 handoff → 匹配 `deliveryId` 的 web-view load；code 不得进入 storage、日志、审计或跨 origin URL。

顾客购物和 OPERATOR 不依赖收费的 `getPhoneNumber`。若会员仍保留微信手机号验证，按独立顾客能力单独配置与验收，不得作为管理员或订单发布门槛。SUPER_ADMIN 只可对具有微信 OpenID/UnionID 的 User 显式授权 OPERATOR，并配置唯一 `AdminUser.loginPhone`；撤权、linked User 停用/合并/失去微信身份必须立即阻断 exchange 与 guard。

## 发布前验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
docker build -f apps/api/Dockerfile -t bake-mall-api:verify .
docker build -f infra/api.Dockerfile -t bake-mall-api:compat-verify .
```

还需用容器实际验证 `migration:run:prod`、非默认 `PORT` health、非 root 用户与 production-only dependencies，并验证 Nginx 首页、深链、assets、API proxy，以及客户端 `X-Request-ID` 绝不会成为 API 或响应请求 ID。
