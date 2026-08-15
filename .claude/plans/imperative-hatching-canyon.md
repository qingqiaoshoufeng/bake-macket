# 微信显式登录、订单联系手机号与管理员授权改造计划

## Context

当前体验有三处概念混淆：生产登录页没有可点击的微信登录入口；商品结算要求每单重复输入手机号；小程序 OPERATOR 又依赖收费的微信手机号授权。目标是把身份、履约联系方式和管理员登录彻底拆开：

- H5 登录页提供明确“微信登录”按钮，由原生小程序执行 `wx.login` 并把一次性 code 安全交回 H5；保留启动时自动登录作为快捷路径。
- 用户在“我的”页保存/修改**订单联系手机号**，仅做 11 位中国大陆手机号格式校验；它不作为身份凭证、不触发用户合并、不满足会员验证门槛。
- checkout 不再输入完整手机号，只展示脱敏账号联系号并提交版本；API 在订单事务内读取服务端保存值并冻结到订单快照。
- OPERATOR 由 SUPER_ADMIN 在 Admin Web 对已微信登录的用户显式授权。小程序按微信用户与 `linkedUserId` 换取管理会话，不再依赖手机号或 `getPhoneNumber`。
- 授权 OPERATOR 时，SUPER_ADMIN 单独配置**管理员登录手机号 + 临时密码**；该手机号存于 `AdminUser`，与顾客身份手机号、订单联系手机号均无关，并支持 PC Admin Web 登录。

已有未提交的应用级微信协调器、启动 hydrate/路由等待、安全 redirect 与匿名登录 401 隔离继续保留；现有“checkout 手填手机号 + API 信任 DTO 手机号”改动将被新方案替换。

## 核心不变量

1. `User.phone/phoneVerified` 保留为历史身份手机号，不由订单联系资料修改。
2. `User.orderContactPhone` 非唯一，不写 JWT，不改 `tokenVersion`，不参与身份合并、会员或管理员权限。
3. `AdminUser.loginPhone` 仅用于 OPERATOR PC 登录，唯一且由 SUPER_ADMIN 配置；小程序管理员换会话只依据微信身份与显式 `linkedUserId` 授权。
4. 订单 `contact_phone` 永远来自事务内锁定的 User 服务端字段，不信任客户端完整手机号。
5. 历史订单快照不随“我的”页修改而变化；已完成幂等 replay 不重新检查当前联系号。
6. 微信 login code 只保存在原生 App 内存与一次性 URL handoff，不进入 storage、日志或任意外部 origin。

## 实施步骤

### 1. 共享契约与错误码（TDD）

修改 `packages/shared-contracts`：

- 为 `CustomerProfileView` / `UserProfileView` 增加订单联系手机号的可辨识状态：`configured`、`maskedPhone`、`version`；身份手机号继续单独表达并脱敏。
- 新增 `UpdateOrderContactPhoneRequest { phone, expectedVersion }` 及响应契约。
- `CreateOrderRequest` 删除完整 `contactPhone`，增加 `orderContactPhoneVersion`；`OrderView.contactPhone` 继续保留为历史快照。
- `AdminUserView` 增加微信身份是否已绑定、管理员登录手机号脱敏状态；`GrantOperatorRequest` 增加 `loginPhone`。
- 保留 `AdminLoginRequest` 的 OPERATOR phone/password 形态，但语义改为 `AdminUser.loginPhone`。
- 新增稳定错误码：订单联系号缺失/版本变化、联系号更新版本冲突、管理员登录手机号冲突等。
- 用 type-test 明确禁止订单请求继续携带完整 `contactPhone`，并覆盖 profile 可辨识联合非法形态。

### 2. 数据库迁移与实体

新增迁移（接续当前最新序号）并更新迁移注册表：

- `users.order_contact_phone VARCHAR(32) NULL`，**不加唯一索引**。
- `users.order_contact_phone_version INT UNSIGNED NOT NULL DEFAULT 0`。
- 将符合 11 位规则的现有 `users.phone` 回填到 `order_contact_phone`，version 设为 `1`；空值或不符合规则的历史值保持空/0。
- `admin_users.login_phone VARCHAR(32) NULL`，只允许 OPERATOR 使用并建立唯一索引；SUPER_ADMIN 继续使用现有 email `username`。
- 更新角色互斥约束：SUPER_ADMIN 要求 email username 且无 loginPhone/linkedUserId；OPERATOR 要求 loginPhone 与 linkedUserId，username 为空。
- 对现有 OPERATOR：仅在其 linked User 有可用历史手机号时回填 `login_phone`；无可回填值的 OPERATOR 设为 inactive、递增 tokenVersion，待 SUPER_ADMIN 重新授权配置。
- 迁移不得修改身份手机号、`phoneVerified` 或历史订单；down 对已产生新数据采用 fail-closed。

更新 `User` 与 `AdminUser` 实体注释，明确三个手机号的不同责任。

### 3. Profile 订单联系手机号 API

在 customer/profile 域新增集中服务与端点：

- `GET /me` 返回身份手机号验证状态和脱敏订单联系号配置/version，前端不再从 localStorage 猜 `phoneVerified`。
- `PUT /me/order-contact-phone`：
  - 锁定当前 User；
  - 校验 active、未合并、11 位手机号和 `expectedVersion`；
  - 相同规范化值视为幂等成功，不递增版本；
  - 真实变化时 version +1；
  - 不修改 `phone/phoneVerified/tokenVersion`，不调用 `mergeVerifiedPhone`；
  - 不要求号码唯一，允许不同用户共用联系号码；
  - 响应只返回脱敏值和版本，日志/审计不记录完整号码。
- 增加并发测试：同一版本的两个更新最多一个不同值成功；更新和下单通过同一 User 行锁线性化。

### 4. “我的”页保存与修改联系手机号

按现有 profile 六模块结构新增 component/hook/api/config/type：

- “我的”页区分“身份手机号（如有）”和“订单联系手机号”。
- 订单联系号未配置时显示“设置”；已配置时只显示脱敏值和“修改”，编辑时要求重新输入完整 11 位号码。
- 支持 `/profile?edit=order-contact-phone&redirect=/checkout` 自动展开表单；保存后用通用安全 redirect helper 返回 checkout。
- PUT 只在请求生命周期持有完整号码，不写入 auth profile/localStorage；保存后用脱敏响应更新 profile 状态。
- 版本冲突时重新加载并提示用户，不静默覆盖。

### 5. Checkout 与订单权威快照

H5：

- 从 `CheckoutFormValues`、defaults、校验和组件中移除 `contactPhone` 输入及事件。
- checkout 显示脱敏账号订单联系手机号摘要和“去我的修改”。
- 未配置时引导到 Profile，不允许提交。
- 创建订单请求只携带 `orderContactPhoneVersion`；服务端缺失/版本变化错误分别跳 Profile 或要求刷新确认。
- 手机号版本进入请求指纹；资料变化后生成新 Idempotency-Key。

API：

- `CreateOrderDto` 删除 `contactPhone`、增加非负整数 `orderContactPhoneVersion`；旧客户端携带完整手机号由严格 ValidationPipe 拒绝，不能覆盖服务端值。
- `OrdersService.create` 保持“completed replay 优先”；新订单事务内按既有锁序锁 User，检查 active/未合并、联系号已配置、版本匹配，再把 `lockedUser.orderContactPhone` 写入 `Order.contactPhone`。
- 联系号修改与下单共用 User 行锁；地址手机号保持独立，不作为 fallback。
- 保留库存、报价、会员金额、幂等及订单不可变快照语义。
- 增加真实 MySQL 并发测试：更新先锁/下单先锁、版本冲突、修改后 replay 仍返回旧快照。

### 6. 显式微信登录按钮与原生 handoff

H5：

- LoginView 使用现有 `wechatAuthState` 驱动 idle/exchanging/failed 状态，始终提供“微信登录/重新微信登录”按钮。
- 新增通用 `requestMiniappWechatLogin()`：复用 `ensureMiniProgramJssdk` 与 `wx.miniProgram.navigateTo`，只导航原生页面，绝不在 H5 调 `wx.login`。
- 非小程序环境诚实提示“请在微信小程序中打开”，不伪造登录成功；开发固定账号只在 DEV 显示。

小程序：

- 新增 `/pages/wechat-login/index`，严格同源校验编码后的 H5 `returnUrl`。
- 原生页由用户点击后调用 `wx.login`，成功时将 `{ code, returnUrl }` 写入 App 内存 handoff，再 `navigateBack`；失败可在原生页重试。
- 抽取/泛化现有 phone handoff store 与 delivery-id 模式；index `onShow` 用 `buildLoginHandoffUrl(returnUrl, code)` 销毁并重建 web-view，只有匹配的 `bindload` 后消费，错误时保留重试。
- 继续保留 index `onLoad` 自动登录作为快捷路径；主动按钮取得的新 code 仍由现有应用级 coordinator 兑换，避免第二套业务消费者。

### 7. OPERATOR 显式授权与独立 PC 登录手机号

后端：

- OPERATOR linked User 资格统一为：存在、active、未合并、存在微信 OpenID 或 UnionID；删除所有 `phone/phoneVerified/orderContactPhone` 条件。
- `GrantOperatorRequest` 要求 SUPER_ADMIN 同时提交独立 `loginPhone`、临时密码/确认密码和当前超级管理员密码。
- 授权事务：锁 User 与 AdminUser，验证微信身份、loginPhone 唯一性和高风险当前密码；保存 `AdminUser.loginPhone`、passwordHash、`mustChangePassword=true`、active 并递增 tokenVersion、脱敏审计。
- OPERATOR PC 登录按 `AdminUser.loginPhone` 直接查 AdminUser，再校验 linked User active/未合并/有微信身份；不读取三种 User 手机号。
- `/admin/auth/exchange` 与 Admin JWT guard 使用同一 eligibility helper；小程序当前微信用户只有被显式 linked 后才能换取 OPERATOR session。
- linked User 被禁用、合并或微信身份被清理时，exchange/guard 立即拒绝；撤权继续 inactive + tokenVersion++。
- 订单联系号、身份手机号变化均不影响 Admin token。
- 首次临时密码和强制改密流程保留；改密后 PC 可用独立 loginPhone + 新密码登录。

Admin Web：

- 用户列表展示“微信已绑定/未绑定”；只有微信已绑定用户可授权 OPERATOR。
- 授权弹窗增加“管理员登录手机号”，与订单联系号/身份手机号文案明确分开。
- PC OPERATOR 登录表单仍为手机号+密码，但标签改为“管理员登录手机号”。
- 搜索/展示只返回 loginPhone 脱敏值，不泄露完整手机号。

小程序：

- 删除 admin flow 对 `getPhoneNumber` 和 `phoneVerified` 的判断；未获授权时不显示/拒绝门店管理，已授权时直接 exchange。
- `/pages/phone-auth/index?flow=admin`、`authorizePhone` 及相关 wiring 从管理员路径移除；若会员仍需微信手机号验证，可保留独立顾客能力，不再用于管理员或商品订单。

### 8. 文档与兼容迁移

同步更新权威文档：

- `docs/superpowers/specs/2026-07-12-bake-mall-design.md`
- `docs/superpowers/specs/2026-08-03-miniapp-cloud-printing-user-admin-design.md`
- `docs/runbook/wechat-miniapp-setup.md`
- `docs/runbook/miniapp-printing-test.md`
- 部署/生产 env 说明（不再要求顾客或 OPERATOR 使用微信手机号付费能力）。

文档明确三类手机号、微信登录按钮的原生 handoff、SUPER_ADMIN 显式授权、独立管理员登录手机号、即时撤权和老数据回填策略。

## 关键文件

- `packages/shared-contracts/src/{customer,auth,order,admin-user,enums}.ts`
- `apps/api/src/database/entities/{user,admin-user}.entity.ts`
- `apps/api/src/database/migrations/0014-*.ts` 与 `index.ts`
- `apps/api/src/customer/me.controller.ts` 及新增订单联系号 service/DTO
- `apps/api/src/orders/{dto/create-order.dto,orders.service}.ts`
- `apps/api/src/users/admin-users.service.ts`
- `apps/api/src/auth/{admin-auth.service,admin-jwt.guard}.ts`
- `apps/h5-store/src/views/{ProfileView,CheckoutView,LoginView}.vue`
- `apps/h5-store/src/views/profile/**`、`checkout/**`、`bridge/miniapp.ts`
- `apps/admin-web/src/views/users/**`、`views/login/**`
- `apps/miniapp-shell/app.ts`、`utils/bridge.ts`、`pages/index/**`、新增 `pages/wechat-login/**`

## 验证

### 自动化

- shared contracts：test/typecheck/build，类型级拒绝旧订单手机号字段。
- API：迁移 spec、订单联系号 service/controller、订单单测/e2e、真实 MySQL 并发、身份合并回归、OPERATOR grant/login/exchange/guard/permission/撤权全矩阵。
- H5：LoginView/JSSDK/handoff/coordinator、Profile 设置修改与冲突、checkout 无手机号输入及 API 错误兜底、router 安全 redirect。
- Admin Web：授权弹窗 loginPhone、微信资格、OPERATOR PC 登录、撤权和脱敏显示。
- Miniapp：原生登录页、同源 return URL、内存 handoff、web-view load 后消费、管理员不再触发 getPhoneNumber。
- 各受影响包运行 test、typecheck、lint、production build；`git diff --check` 和 Prettier 通过。

### 端到端

1. 小程序打开后可自动登录；清 session 后登录页仍可点击“微信登录”，原生取得新 code 并返回原 redirect。
2. 新用户进入 checkout 被引导到“我的”，保存订单联系号后返回；checkout 不存在手机号输入，POST `/orders` 不含完整手机号。
3. API 订单快照使用服务器保存值；修改资料后旧订单不变、新订单使用新值；幂等 replay 保持旧快照。
4. SUPER_ADMIN 在 Admin Web 找到已微信登录用户，配置独立管理员登录手机号和临时密码并授权；未绑定微信用户无法授权。
5. 该员工可用当前微信进入小程序门店管理，也可用管理员登录手机号+首次改后的密码登录 PC Admin。
6. 撤权、用户禁用/合并或微信身份失效后，现有 Admin token 立即无效；修改订单联系号不影响管理员会话。
7. 真机验证 iOS/Android 微信 WebView；Safari 15 基线下启动路径不引入受限 API。
