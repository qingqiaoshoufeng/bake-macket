# 单一小程序、用户管理与芯烨云打印设计

## 1. 文档地位

本文是 `bake-mall` 用户管理、普通管理员、小程序管理区和订单云打印的权威设计规格。

本文是新路径的权威设计规格。以下 Android / 局域网原始 TCP 打印方案仅在新路径尚未完成真实验收时作为过渡路径保留；新路径通过本文第 21 节阶段门和第 19.6 节真实验收后，本文正式取代这些旧方案：

- `docs/superpowers/specs/2026-08-02-order-receipt-printing-design.md`
- `docs/superpowers/plans/2026-08-02-order-receipt-printing-a-device-poc.md`
- `docs/superpowers/plans/2026-08-02-order-receipt-printing-b-reliable-backend.md`
- `docs/superpowers/plans/2026-08-02-order-receipt-printing-c-android-terminal.md`
- `docs/superpowers/plans/2026-08-02-order-receipt-printing-d-admin-operations-and-acceptance.md`

新路径完成真实验收后，删除 Android 商家终端、HBuilderX、adb、UTS、BLE、局域网 RAW TCP 和 XP-58IIH capability fixture 相关代码与门禁。可复用的纯小票排版规则迁移到 API 服务端，不保留 Android 外壳。真实验收通过前不得退役当前可用 Android 路径。

当前仍保持**单商家**架构，不在本任务中引入 `merchant_id`、多租户数据隔离或平台入驻结算。数据和接口边界应避免阻碍未来多商家扩展，但不得为未知需求提前实现多租户。

## 2. 背景与决策

`bake-mall` 已具备：

- 顾客 H5 商城和原生微信小程序薄壳；
- 独立 `mall-user` 与 `mall-admin` JWT audience；
- Admin Web；
- 不可变订单和订单项快照；
- 订单列表、详情、状态流转与导出；
- 审计日志基础设施。

原设计依赖 uni-app Android 常驻终端和局域网 TCP 打印机。该方案需要 HBuilderX、Android SDK、签名、APK、Foreground Service、设备配对、原生 ledger 和真机维护，超出当前门店的实施成本。

新决策是：

1. 只维护一个微信小程序，普通顾客与普通管理员共用；
2. 保留 Admin Web；
3. 用户管理同时提供于 Admin Web 和小程序管理员区；
4. 打印由 API 服务端调用芯烨云开放平台，不由手机直连打印机；
5. 第一版只支持人工单张和批量打印，不自动打印新订单；
6. 当前店铺可绑定多台芯烨云打印机，每次打印只选择一台；
7. Android、BLE 和局域网 TCP 打印不再是产品路径。

## 3. 目标与非目标

### 3.1 目标

1. Admin Web 展示全部消费用户，并支持按手机号手动添加用户。
2. 系统超级管理员可将消费用户授予或撤销普通管理员权限。
3. 普通管理员使用原消费账号进入同一个微信小程序的管理区。
4. 普通管理员也可使用手机号和管理员操作密码登录 Admin Web。
5. `mall-user` 与 `mall-admin` 身份继续严格隔离。
6. 超级管理员和普通管理员可安全绑定、验证、查询和解绑多台芯烨云打印机。
7. 管理员可选择一台在线打印机，对所有非取消订单执行单张或批量打印。
8. 批量打印支持部分失败、进度展示、中断后手动继续，并可基于明确失败项创建新的打印意图。
9. 小票使用订单不可变快照，金额始终为整数分，手机号脱敏，备注过滤控制字符。
10. 所有高风险权限和打印机操作有二次验证、限流和审计。

### 3.2 非目标

首期不实现：

- 多商家、多门店、多租户；
- 新订单自动打印；
- Android App、HBuilderX 或后台常驻打印 worker；
- BLE、USB 或局域网 TCP 打印；
- 一次打印任务同时发送到多台打印机；
- 打印标签、厨房分单、多联单或图片小票；
- 强制补打原因；
- 短信发送临时管理员密码；
- 普通管理员管理商品、分类、会员等级或首页配置；
- 物理层严格 exactly-once 承诺；
- 在客户端保存芯烨云 `UserKEY`。

## 4. 总体架构

```text
普通顾客
  微信小程序原生薄壳
    └─ web-view：H5 商城
          └─ mall-user API

普通管理员（同一个小程序）
  原消费账号登录
    ├─ 顾客 H5 商城
    └─ 原生小程序管理区
         ├─ 全部订单
         ├─ 用户管理
         ├─ 云打印机管理
         └─ 单张/批量打印
                │
                ▼ mall-admin API

Admin Web
  ├─ SUPER_ADMIN：完整后台 + 用户授权
  └─ OPERATOR：订单、打印、用户查看/添加
                │
                ▼
NestJS API + MySQL
  ├─ 用户与管理员身份
  ├─ 权限与二次验证
  ├─ 云打印机所有权验证
  ├─ 持久打印批次和任务
  ├─ 服务端小票渲染
  ├─ 幂等与审计
  └─ 芯烨云 adapter
                │ HTTPS
                ▼
          芯烨云开放平台
                │
                ▼
          商家云打印机
```

### 4.1 单一小程序边界

- 顾客购物继续使用现有 H5 `web-view`。
- 原生小程序根据服务端身份结果展示管理入口；前端本地字段不能授予权限。
- 小程序管理员区使用原生页面调用管理 API，不依赖 `web-view postMessage` 实时传递管理动作。
- 小程序不得持有芯烨云密钥。
- 小程序退出不影响已被 API 和芯烨云接受的打印任务。

### 4.2 Admin Web 边界

- 保留现有超级管理员完整后台。
- 普通管理员登录后只显示并只能调用获授权模块。
- 前端菜单隐藏不是权限控制；API 必须按角色和 permission 拒绝越权请求。
- Admin Web 与小程序管理区共用 `@bake-mall/contracts` DTO、枚举、错误码和权限语义。

### 4.3 API 边界

- API 是用户角色、打印机绑定、打印任务和审计的唯一可信源。
- API 生成芯烨云签名并调用厂商接口。
- API 只从订单不可变快照构造小票，不信任客户端金额、商品名、地址或备注。
- API 对厂商超时和结果未知 fail closed，不盲目重复发送。

## 5. 身份与权限模型

### 5.1 账户类型

| 类型          | 关联消费用户 | 登录方式                                                                       | 权限                                                        |
| ------------- | ------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `SUPER_ADMIN` | 否           | Admin Web `username`（邮箱）+ 环境初始化密码                                   | 现有完整后台、用户管理、管理员授权/撤销、订单、打印机和打印 |
| `OPERATOR`    | 是           | 小程序微信 linked User；Admin Web 独立 `AdminUser.loginPhone` + 管理员操作密码 | 仅限第 7 节 permission 白名单                               |
| 普通 `User`   | 不适用       | 微信或手机号                                                                   | 商城、个人资料和自己的订单                                  |

### 5.2 超级管理员

- 初始超级管理员继续由 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 引导创建。
- `admin_users.username` 可空，但仅 `SUPER_ADMIN` 必须具有唯一非空 username；该值为 Admin Web 登录邮箱。
- 超级管理员只使用 Admin Web，不进入小程序管理区。
- 超级管理员不可撤销、不可降级，也不关联消费用户。
- 只有超级管理员能授予或撤销 `OPERATOR`。
- 迁移时将所有现有 `admin_users` 回填为 `SUPER_ADMIN`，保留其 username 与密码 hash，不自动关联消费用户。

### 5.3 普通管理员

- 一个 `OPERATOR` 必须唯一关联一个已有消费用户，`linked_user_id` 非空且唯一；该 linked User 必须 active、未合并，并至少具有微信 OpenID 或 UnionID。
- `OPERATOR.username` 必须为 null；`AdminUser.loginPhone` 是唯一、独立的 PC 管理员登录手机号，由 SUPER_ADMIN 授权时配置。不得从 `User.phone` 或 `User.orderContactPhone` 动态推导，也不得把 username 作为普通管理员身份事实源。
- Admin Web 登录直接按规范化后的 `AdminUser.loginPhone` 查询 OPERATOR，再校验 linked User 的微信资格；不读取 `User.phone`、`phoneVerified` 或 `orderContactPhone`。
- 消费用户被授权后，继续使用原微信/手机号顾客身份；小程序使用有效 `mall-user` 会话按当前微信 linked User 换取独立 `mall-admin` 会话，不调用收费的 `getPhoneNumber`。
- 普通管理员不能管理第 7 节白名单之外的任何能力。
- linked User 被停用、合并或失去全部微信 OpenID/UnionID 时，登录、exchange 与每次 guard 都 fail closed；SUPER_ADMIN 撤权时停用 OPERATOR 并递增 `AdminUser.tokenVersion`，现有管理 token 立即失效。
- `User.phone`、`phoneVerified` 或 `orderContactPhone` 变化不授予、不撤销 OPERATOR，也不改变其 token；会员若保留手机号验证，是独立顾客能力。

### 5.4 JWT 隔离

继续使用：

- `mall-user`：顾客会话；
- `mall-admin`：超级管理员或普通管理员管理会话。

`mall-admin` payload 至少包含：

- `sub`：`admin_users.id`；
- `aud: mall-admin`；
- `role: SUPER_ADMIN | OPERATOR`；
- `tokenVersion`；
- 对 `OPERATOR` 可包含 `linkedUserId`，不得用它替代服务端身份、手机号验证状态或权限查询。

`JwtAdminGuard` 必须在每个管理请求中确认：

- 管理员仍存在；
- `isActive=true`；
- token version 仍有效；
- `OPERATOR` 的 linked User 仍存在、active、未合并，且仍具有微信 OpenID 或 UnionID；
- 当前角色和 endpoint permission 匹配。

撤权、管理员停用和操作密码变更时递增 `AdminUser.tokenVersion`，使现有 `mall-admin` token 立即失效；linked User 停用、合并或微信身份被清理时，即使 token version 未变化，exchange 与每次 guard 也会立即拒绝。顾客三类手机号变化均不影响管理员 token。

### 5.5 首次修改临时密码

超级管理员授权消费用户为普通管理员时：

1. 超级管理员重新输入自己的密码；
2. 超级管理员手动输入并确认临时管理员操作密码；
3. 服务端只保存 bcrypt hash，不在响应中回显密码；
4. 设置 `mustChangePassword=true`；
5. 新管理员首次进入管理能力时，只能访问首次改密、退出和必要身份端点；
6. 小程序换取管理会话或 Admin Web 使用临时密码登录时返回受限 `mall-admin` 会话和明确状态；
7. 首次改密请求必须同时提交临时密码、新密码和新密码确认值，服务端验证临时密码正确、新密码符合策略且两次新密码一致；
8. 临时密码验证复用第 5.6 节已认证流程的每管理员精确窗口：5 分钟内最多 5 次失败，不另开可绕过的计数窗口；
9. 修改成功后更新密码 hash、清除 `mustChangePassword`、递增 `tokenVersion` 并重置该管理员精确窗口；旧受限 token 立即失效；
10. 成功响应直接返回新的完整 `mall-admin` 管理会话；不引入一次性换取凭证或第二次换取请求，旧受限 token 不允许继续使用。

### 5.6 管理员操作密码

- 仅接受 ASCII 数字；
- 至少 6 位；
- 服务端不得记录、回显或审计明文；
- 存储 bcrypt hash；
- 普通管理员登录 Admin Web 时使用；
- 绑定、解绑打印机等高风险操作必须再次验证；
- 超级管理员的二次验证使用现有超级管理员密码。

公开 `SUPER_ADMIN`/`OPERATOR` 登录与已认证密码验证采用分层限流，不共用同一种计数键：

- 公开登录使用固定 **1024** 个持久 bucket。服务端先按登录联合的 `kind` 分别规范化 email/phone，再以服务端 secret 执行 `HMAC(kind + normalized identifier)` 并映射到 `[0, 1023]`；不得保存原始标识符、可逆标识符或为 unknown 标识符逐条建行；
- known 与 unknown 标识符的公开响应仅由 bucket 窗口决定：同一 bucket 5 分钟内前 5 次失败统一返回通用 `401`，第 6 次及后续统一返回 `429`。bucket 碰撞会让无关标识符共享更严格限制，不得因已查到管理员而提前暴露不同响应；
- 对 known 管理员，公开登录还叠加 `admin_users` 上每管理员 5 分钟 5 次的精确失败窗口，用于保护具体账户，但该精确窗口不得在 bucket 尚未到第 6 次时把外部响应提前改成 `429`；
- 公开登录成功只重置该管理员精确窗口，不重置共享 bucket，避免 known 成功请求替同 bucket 的攻击流量清零；公开失败 attempt 只原子聚合到固定 bucket 行，不逐次写 `AuditLog`；
- 首次改密、普通改密和高风险二次验证继续只使用每管理员精确窗口：5 分钟内最多 5 次失败，成功重置该窗口，成功、失败和限流均逐次写不含密码、完整标识符或其他 PII 的脱敏 `AuditLog`；
- 两类窗口都不做持久账户锁定，且必须通过短事务、行锁或原子条件更新处理窗口滚动与计数，不能被并发请求绕过；
- 固定 bucket 是无 Redis 默认方案：它以有界存储牺牲 unknown 标识符的精确隔离和碰撞时的可用性；首期接受该不可兼得关系，不退回每 unknown 标识符一行的无界设计。

## 6. 用户管理

### 6.1 消费用户列表

Admin Web 和小程序管理员区均提供：

- 分页；
- 手机号、昵称或用户 ID 搜索；
- 创建时间；
- 手机号验证状态；
- 当前是否为普通管理员；
- 管理员是否激活、是否必须修改临时密码。

接口不得返回密码 hash、微信 OpenID/UnionID、JWT 或其他 secret。

### 6.2 手动添加消费用户与 placeholder 合并

- 超级管理员和普通管理员均可添加；
- 手机号是全局唯一身份键；
- 服务端统一规范化并校验手机号；
- 重复手机号返回确定性冲突错误；
- 并发添加由数据库唯一约束兜底；
- 手动创建的 User 是 `placeholder`，`phoneVerified=false`，不能伪造用户已验证手机号；
- placeholder 的历史身份手机号与 `phoneVerified` 只服务身份归一和保留的会员验证能力；商品下单改为检查 `User.orderContactPhone` 已配置并匹配客户端提交的版本，不要求 `User.phone` 或 `phoneVerified`。

用户以后通过真实短信或微信手机号流程验证 placeholder 的同一规范化手机号时，必须执行显式、原子的用户合并，禁止静默保留两个用户：

1. 在短数据库事务中按稳定顺序锁定手机号 placeholder、当前微信 User，以及关联这两个 User 的 `admin_users`；手机号 placeholder 是 canonical User，其 ID 保持不变。
2. 若当前微信 User 与 placeholder 已是同一记录，将 canonical User 设为 `phoneVerified=true`，并在同一事务递增 canonical 的 `token_version`，再按身份安全规则处理关联管理员。
3. 若是两条记录，只有 source 微信 User 不含不可安全迁移的财务事实时才允许自动合并。阻断事实至少包括订单、会员购买记录、当前或历史会员资格、membership credit entries、credit allocations，以及其他会改变金额、余额、权益归属或审计链的记录。
4. 任一阻断事实存在时返回确定性“用户合并需人工处理”冲突，不修改任何记录；管理员必须先通过独立人工流程收敛财务事实，验证流程不得自动选一条或生成第三个用户。
5. placeholder 与 source 的 OpenID 或 UnionID 只要存在不相同的非空值，即拒绝合并并返回确定性身份冲突；不存在冲突时把 source 的微信 OpenID/UnionID 迁移到 canonical User。
6. source 的地址全部重挂到 canonical User。购物车按 SKU 合并：相同 SKU 的数量相加并保留一项，不同 SKU 直接重挂；合并仍须满足既有数量上限和数据完整性约束，无法满足时整笔事务冲突回滚。
7. 原子更新所有指向 source 的 `OPERATOR.linked_user_id` 为 canonical ID；正常情况下管理员已指向 placeholder。若更新会违反一个 User 仅一个 OPERATOR 或其他唯一约束，整笔事务返回确定性冲突并人工处理。
8. 两记录合并时，canonical User 写入已验证手机号、设 `phoneVerified=true` 并递增 canonical 的 `token_version`；同一事务把 source 保留为 tombstone：设置 `is_active=false`、`merged_into_user_id=canonical User.id`、递增 source 的 `token_version`，并清除其可登录微信身份。不得物理删除 source，也不得继续下单、换取 token 或作为管理员关联目标。
9. `users` 首期必须新增 `is_active`、`merged_into_user_id` 和 `token_version`；`mall-user` JWT 必须携带 `tokenVersion`，`JwtUserGuard` 每次确认 User 仍 active、未合并且版本一致。所有既有 User 迁移回填 `is_active=true`、`token_version=1`、`merged_into_user_id=null`。
10. 合并成功后，手机号验证响应必须直接为 canonical User 签发新的完整 `mall-user` 会话；source 和 canonical 的所有旧 `mall-user` token 均因版本更新而立即失效，客户端不得继续使用合并前会话。
11. 合并、拒绝原因、迁移实体计数、canonical/source ID 和关联管理员变更写入不含 PII 的审计。

厂商网络调用不参与该合并事务；手机号验证凭证可在事务前完成真实性校验，但消费验证凭证与提交合并之间必须防重放并由条件更新保证一次性。

### 6.3 授予普通管理员

仅超级管理员可执行：

1. 锁定目标用户和管理员身份记录；
2. 验证超级管理员当前密码和限流；
3. 校验临时操作密码和确认值；
4. 若目标已是激活管理员，返回幂等结果或明确冲突，不重复创建；
5. 创建或重新激活唯一关联的 `OPERATOR`；
6. 保存 bcrypt hash，设置 `mustChangePassword=true`；
7. 递增 token version；
8. 写入成功审计。

### 6.4 撤销普通管理员

- 仅超级管理员可执行；
- 超级管理员必须重新输入自己的密码；
- 超级管理员不能撤销自己；
- `SUPER_ADMIN` 不能被撤销；
- 将普通管理员设为 inactive，并递增 token version；
- 消费用户记录和历史业务数据保留；
- 已有打印任务和审计记录保留；
- 现有管理 token 立即失效；
- 操作写入审计。

## 7. 权限白名单与矩阵

共享契约必须定义以下 permission 常量，API guard、Admin Web 和小程序统一引用，不允许控制器或客户端散落字符串：

- `ORDER_READ`
- `ORDER_STATUS_UPDATE`
- `USER_READ`
- `USER_CREATE`
- `PRINT_DEVICE_MANAGE`
- `PRINT_EXECUTE`
- `PRINT_HISTORY_READ`
- `SELF_PASSWORD_CHANGE`

`OPERATOR` 权限采用严格白名单，只拥有上述八项 permission。既有 admin endpoint 默认仅 `SUPER_ADMIN` 可访问；只有 endpoint 显式声明上述 permission 时才向 `OPERATOR` 开放。新增 endpoint 也遵循相同默认拒绝规则，不能因位于订单、用户或打印模块而自动继承访问权。

| 能力                             | 所需 permission                          |     SUPER_ADMIN |                        OPERATOR | 普通用户 |
| -------------------------------- | ---------------------------------------- | --------------: | ------------------------------: | -------: |
| 查看全部消费用户                 | `USER_READ`                              |              是 |                              是 |       否 |
| 手动添加消费用户                 | `USER_CREATE`                            |              是 |                              是 |       否 |
| 授予/撤销管理员                  | SUPER_ADMIN only                         |              是 |                              否 |       否 |
| 查看全部订单及详情               | `ORDER_READ`                             |              是 |                              是 |       否 |
| 修改合法订单状态                 | `ORDER_STATUS_UPDATE`                    |              是 |                              是 |       否 |
| 单张/批量打印                    | `PRINT_EXECUTE`                          |              是 |                              是 |       否 |
| 查看打印批次和历史               | `PRINT_HISTORY_READ`                     |              是 |                              是 |       否 |
| 绑定、恢复、重命名、解绑云打印机 | `PRINT_DEVICE_MANAGE`                    |  是，需二次验证 |                  是，需二次验证 |       否 |
| 修改自己的操作密码               | `SELF_PASSWORD_CHANGE`                   |              是 |                              是 |       否 |
| Admin Web 登录                   | 身份端点                                 | username + 密码 | 独立管理员登录手机号 + 操作密码 |       否 |
| 小程序管理区                     | 微信 linked User + 管理会话 + permission |              否 |     是，不依赖 `getPhoneNumber` |       否 |

`OPERATOR` 明确不得访问 dashboard、订单导出、supply、supply-items、商品、分类、会员、购卡记录、首页配置、upload、管理员与角色管理。其路由、导航和 API 均必须拒绝；不能通过聚合统计、导出或上传端点间接取得相同数据或能力。Admin Web 的 `OPERATOR` 登录成功后默认跳转订单列表，不进入 dashboard。

## 8. 云打印机模型与绑定

### 8.1 多打印机

- 当前单店可绑定多台芯烨云打印机；
- SN/PID 在本平台全局唯一；
- 每次单张或批量打印只选择一台；
- 不同时向多台设备发送同一任务；
- 客户端按当前管理员记住上次选择的打印机 ID；
- 已解绑设备自动清除本地选择；
- 离线设备不能提交打印。

### 8.2 打印机状态

首期必须实现以下状态：

- `BINDING`：本地已持久化绑定意图，厂商添加或验证码发送尚未得到可安全提交的明确结果；禁止订单打印和同 SN 新建记录；
- `PENDING_VERIFICATION`：厂商明确添加成功且验证码明确发送成功，等待纸面验证；
- `ACTIVE`：纸面验证成功，可用于打印；
- `UNBINDING`：正在执行明确解绑；不接受新任务；
- `UNBOUND`：当前绑定周期已结束且厂商已明确删除；不可打印，但允许同一本地 SN 记录在新的幂等绑定意图下转回 `BINDING`，因此不是记录生命周期的绝对终态；
- `ERROR`：厂商关联、验证码发送或删除补偿结果未知，或发现需人工收敛的冲突；禁止重复绑定和订单打印。

在线/离线是厂商实时状态或最多 30 秒缓存字段，不替代绑定状态。

### 8.3 安全绑定与补偿状态机

超级管理员和普通管理员均可发起。厂商调用和验证码发送不得放在数据库长事务中，流程拆分为可恢复的短事务与外部调用：

1. 输入完整 SN/PID 并重新输入管理员操作密码；API 完成限流、permission 和唯一性检查。
2. 在短事务中创建唯一 `cloud_printers` 记录并置为 `BINDING`，持久化请求幂等键、操作管理员和绑定阶段；事务提交后才调用芯烨云 `addPrinters`。同 SN 唯一约束确保任何崩溃恢复期间不能重复创建。
3. `addPrinters` 明确失败且能确认厂商未建立关联时，在短事务记录厂商分类并将本地记录转为 `UNBOUND`；后续重试复用该记录。若失败表示“已存在”或不能确认是否建立关联，按第 8.4 节处理，不得直接转 `UNBOUND`。
4. `addPrinters` 明确成功后，生成高熵随机纸面验证码；在短事务中仅保存验证码 hash、5 分钟过期时间、失败次数零和发送阶段，提交后再调用厂商提交不含订单/顾客 PII 的验证码小票。
5. 验证码明确发送成功时，在短事务把状态转为 `PENDING_VERIFICATION`。管理员在 5 分钟内回填，最多 5 次失败；验证成功后短事务置 `ACTIVE` 并立即清除 challenge。
6. 验证码明确发送失败时调用 `delPrinters` 补偿。补偿明确成功后，本地记录转为不可打印的 `UNBOUND` 并清除 challenge；后续重新发起绑定必须复用该 SN 的同一本地记录并重新进入 `BINDING`。补偿明确失败时将本地记录置为 `ERROR` 并记录确定性错误，允许管理员重试“确认删除”，但在确认厂商已删除前禁止新绑定和打印。
7. 验证码发送结果为 `UNKNOWN`，或删除补偿结果为 `UNKNOWN` 时，将记录置为 `ERROR`；禁止重复绑定和订单打印，必须使用第 8.4 节恢复操作收敛。
8. 任一步骤在厂商成功后、数据库状态提交前崩溃，由 reconciliation job 扫描停留过久的 `BINDING`/`UNBINDING`/`ERROR` 记录，查询厂商关联并推进到可证明的状态；管理员也可触发同一恢复逻辑。reconciliation job 只修复绑定状态，不自动消费打印 job。

challenge 过期或 5 次失败耗尽不调用 `delPrinters`，也不创建同 SN 新记录。服务端清除旧 challenge 后，在同一本地记录和同一厂商绑定上生成新 challenge，并重新发送验证码；发送过程继续遵循上述明确成功、明确失败和 `UNKNOWN` 分类。只有管理员明确解绑才调用 `delPrinters`。

未完成纸面验证的设备不能打印订单。仅知道 SN/PID 不足以证明设备所有权。

### 8.4 厂商绑定冲突与恢复操作

服务端必须映射芯烨云错误，包括设备号无效、设备已存在或已绑定其他账号、定制设备限制、关联开发者账号达到上限、厂商限流和服务不可用。

`addPrinters` 返回“已存在”时：

- 只有本地同 SN 唯一记录能够证明该设备此前由本系统同一厂商账号绑定，才能进入恢复流程并查询厂商关联；
- 查询确认关联一致后，在同一本地记录继续验证码挑战，不能创建第二条记录；
- 本地无记录、记录无法证明归属、厂商账号不一致或查询无法验证时，返回确定性冲突并置已有本地记录为 `ERROR`（如存在），不得把设备据为本系统所有。

管理员恢复操作必须包括：

- **重新查询厂商关联**：把 `BINDING`/`ERROR` 的厂商归属收敛为已关联、未关联或仍未知；仍未知时保持 `ERROR`；
- **重发验证码**：仅在厂商关联明确属于本系统时，在同一绑定上清旧 challenge 并创建新 challenge；
- **确认删除**：对补偿或解绑未收敛的记录重新调用或查询 `delPrinters`，仅在明确删除后转为本地 `UNBOUND`。

不得把厂商内部签名、`UserKEY` 或原始敏感错误回显客户端。

### 8.5 解绑与取消批次

解绑要求：

- 管理员重新输入操作密码并在客户端二次确认；
- 任何引用该设备的非终态 batch 或 job 都阻止解绑，不限于正在提交的批次；
- 管理员可先取消批次：只把尚未提交的 `PENDING` job 置为 `CANCELLED`；已 `ACCEPTED` job 保留；`SUBMITTING`、`UNKNOWN`、`MANUAL_REVIEW` 必须先按第 12.5 节收敛，不能由取消操作覆盖；
- 所有引用归于终态后，在短事务条件更新设备为 `UNBINDING`，提交后调用芯烨云 `delPrinters`；
- 厂商明确删除成功后，才在新短事务将本地状态置为 `UNBOUND` 并写入 `unbound_at`；
- 厂商明确删除失败时，本地保持原绑定状态，不完成本地解绑；若无法安全恢复为原状态则保留 `ERROR`，但不得标记解绑成功；
- 厂商删除结果 `UNKNOWN` 时保持 `UNBINDING` 或转 `ERROR`，禁止新打印和重复解绑，使用“确认删除”恢复；
- 历史打印任务保留，只取消可用设备关系；
- 全过程写审计。

## 9. 芯烨云 adapter

### 9.1 配置

仅 API 服务端读取：

```text
XPYUN_USER
XPYUN_USER_KEY
XPYUN_BASE_URL=https://open.xpyun.net
XPYUN_TIMEOUT_MS
```

- `UserKEY` 只进入生产 secret manager 或被忽略的本地环境文件；
- 不进入共享 contracts、小程序、H5、数据库、日志或错误响应；
- 生产配置校验缺少凭据时 fail fast；
- 自动测试使用 fake adapter，不访问真实厂商。

### 9.2 adapter 职责

统一封装：

- 添加打印机；
- 删除打印机；
- 查询在线状态；
- 提交小票；
- 查询厂商订单/打印状态；
- 厂商签名；
- timeout、错误码和响应 schema 校验；
- 安全日志摘要。

业务 service 不拼厂商签名，不依赖厂商原始 DTO。

### 9.3 结果分类

adapter 对提交调用统一分类为：

- `ACCEPTED`：厂商明确接受并返回可追踪任务号；只表示提交意图被接受，不表示物理出纸成功；
- `FAILED`：厂商明确未接受，可在管理员指示下创建新的打印意图；
- `UNKNOWN`：请求超时、连接中断或响应无法验证，不能自动重发；
- `REJECTED`：本系统在调用前因设备不存在、已解绑、非 `ACTIVE`、离线、permission 或订单状态不允许而拒绝，不表示厂商调用结果。

`UNKNOWN` 必须先查询厂商任务状态；明确接受转 `ACCEPTED`，明确未接受转 `FAILED`，持续无法确认转 `MANUAL_REVIEW`，不得盲目重印。全文统一使用 `ACCEPTED` 和 `accepted_count` 表达厂商接受，不得用任何“成功”状态或计数表达物理出纸。

## 10. 打印数据模型

所有表继续遵循现有 MySQL 约定：InnoDB、`utf8mb4_unicode_ci`、`BIGINT UNSIGNED`、UTC `DATETIME`、显式索引和迁移。

### 10.1 `users` 身份安全扩展

首期必须新增：

| 字段                  | 语义                                                    |
| --------------------- | ------------------------------------------------------- |
| `is_active`           | 是否允许登录、下单和换取 token；既有用户迁移回填 `true` |
| `merged_into_user_id` | tombstone source 指向 canonical User；正常用户为 null   |
| `token_version`       | `mall-user` token 版本；既有用户迁移回填 1              |

`mall-user` JWT 必须携带 `tokenVersion`。`JwtUserGuard` 每次加载 User 并确认 `is_active=true`、`merged_into_user_id=null`、token version 一致。用户合并、停用或其他要求旧顾客会话立即失效的安全事件必须递增该版本。

### 10.2 `admin_users` 扩展

首期必须新增或调整：

| 字段                       | 语义                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `username`                 | 可空且非空值唯一；`SUPER_ADMIN` 必须为邮箱 username，`OPERATOR` 必须为 null                       |
| `role`                     | `SUPER_ADMIN` 或 `OPERATOR`                                                                       |
| `login_phone`              | `OPERATOR` 必须具有的唯一 PC 登录手机号；`SUPER_ADMIN` 必须为 null；不来自 User 三类履约/身份字段 |
| `linked_user_id`           | `OPERATOR` 必须关联具有微信 OpenID/UnionID 的有效消费用户；`SUPER_ADMIN` 必须为 null；唯一外键    |
| `must_change_password`     | 是否必须修改临时操作密码                                                                          |
| `token_version`            | 撤权、管理员停用和密码事件使旧 token 失效                                                         |
| `verify_failed_count`      | known 管理员公开登录叠加保护，以及首次/普通改密与高风险二次验证复用的每管理员精确失败次数         |
| `verify_window_started_at` | 每管理员 5 分钟精确失败窗口起点，可空                                                             |
| `last_password_changed_at` | 密码最近修改时间                                                                                  |

保留 `password_hash`。数据库约束或等效 service invariant 必须保证角色与 `username`/`login_phone`/`linked_user_id` 的互斥组合。新建或重新授权 OPERATOR 时 username 为 null，由 SUPER_ADMIN 明确提交唯一 `loginPhone`。0014 对 legacy OPERATOR 仅在 linked User 有合法历史身份手机号时一次性回填 `login_phone`；无法回填者设为 inactive 并递增 token version，等待重新授权。唯一索引处理并发 race，迁移 `down` 对新数据与 legacy 停用状态 fail closed。

### 10.3 `admin_login_verification_buckets`

首期必须创建固定 1024 行的公开管理员登录失败聚合表：

| 字段                | 语义                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `bucket_id`         | `SMALLINT UNSIGNED` 主键，值域固定为 0–1023；迁移预置全部 1024 行 |
| `failed_count`      | 当前 5 分钟窗口公开登录失败次数；使用 `INT UNSIGNED`              |
| `window_started_at` | 当前 bucket 窗口起点，UTC `DATETIME`，无活跃窗口时可空            |
| `updated_at`        | 最近原子更新时刻，UTC `DATETIME`                                  |

bucket ID 只在运行时由服务端 secret 对 `kind + normalized identifier` 做 HMAC 后映射得出；表内不得出现 email、phone、其普通 hash、管理员 ID 或逐次 attempt。公开登录失败通过锁定或原子条件更新对应 bucket 行聚合；known 管理员的精确窗口仍保留在 `admin_users`，两层更新必须在明确锁序下完成。

迁移 `down` 在任何 bucket 的 `failed_count > 0` 或 `window_started_at IS NOT NULL` 时必须拒绝，并在执行任何 DDL 前完成全部 guard；拒绝路径以迁移前后 schema 快照证明零 DDL、schema 不变。仅当其他身份域数据 guard 也全部通过且 1024 行均为空闲时，才允许删除该表。

### 10.4 `cloud_printers`

首期必须包含：

| 字段                           | 语义                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `id`                           | 主键                                                                         |
| `serial_number`                | 厂商 SN/PID，服务端敏感字段，唯一；解绑后仍保留历史唯一记录以支持恢复与审计  |
| `display_name`                 | 管理员设置的名称                                                             |
| `status`                       | `BINDING`、`PENDING_VERIFICATION`、`ACTIVE`、`UNBINDING`、`UNBOUND`、`ERROR` |
| `binding_stage`                | add、验证码发送、补偿删除、解绑删除或 reconciliation 的当前可恢复阶段        |
| `vendor_relation_state`        | `CONFIRMED_BOUND`、`CONFIRMED_UNBOUND` 或 `UNKNOWN`                          |
| `binding_idempotency_key`      | 当前绑定意图幂等键                                                           |
| `verification_code_hash`       | 待验证时的一次性验证码 hash，可空                                            |
| `verification_expires_at`      | 5 分钟过期时间，可空                                                         |
| `verification_failed_attempts` | 最多 5 次                                                                    |
| `verified_at`                  | 纸面验证成功时间，可空                                                       |
| `last_online_status`           | 最近厂商在线状态                                                             |
| `last_status_checked_at`       | 最近查询时间；缓存最多使用 30 秒                                             |
| `bound_by_admin_id`            | 发起绑定管理员                                                               |
| `last_vendor_error_code`       | 脱敏厂商错误分类，可空                                                       |
| `unbound_at`                   | 本地明确解绑完成时间，可空                                                   |
| `version`                      | 条件更新/乐观锁版本                                                          |
| `created_at` / `updated_at`    | UTC 时间                                                                     |

列表响应只返回脱敏 SN，例如保留前后少量字符。

### 10.5 `print_batches`

| 字段                        | 语义                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `id`                        | 批次主键；单张打印也可使用一项批次                                                       |
| `printer_id`                | 本批次固定选择的一台打印机                                                               |
| `created_by_admin_id`       | 操作管理员                                                                               |
| `status`                    | `DRAFT`、`READY`、`RUNNING`、`PAUSED`、`COMPLETED`、`COMPLETED_WITH_ISSUES`、`CANCELLED` |
| `lease_owner`               | 当前 process 请求的唯一认领者，可空                                                      |
| `lease_expires_at`          | 60 秒处理租约到期时间，可空                                                              |
| `total_count`               | 总 job 数                                                                                |
| `classified_count`          | 已进入 job 终态的数量；不包含 `PENDING`、`SUBMITTING`、`UNKNOWN` 或 `MANUAL_REVIEW`      |
| `accepted_count`            | 当前为 `ACCEPTED` 的数量，不表示物理出纸                                                 |
| `failed_count`              | 当前为 `FAILED` 的数量                                                                   |
| `manual_review_count`       | 当前仍为非终态 `MANUAL_REVIEW` 的数量，仅用于进度和告警，不计入 `classified_count`       |
| `manually_resolved_count`   | 当前为 `MANUALLY_CONFIRMED_PRINTED` 或 `MANUALLY_CLOSED` 的数量                          |
| `cancelled_count`           | 当前为 `CANCELLED` 的数量                                                                |
| `created_at` / `updated_at` | UTC 时间                                                                                 |

批次计数必须由当前 job 状态事务更新或重算，并满足：`classified_count = accepted_count + failed_count + manually_resolved_count + cancelled_count`；`classified_count + pending_count + submitting_count + unknown_count + manual_review_count = total_count`，其中动态非终态计数可以查询重算而不必全部持久化。任何计数不得为负数或超过 `total_count`。只有 `classified_count=total_count` 且 `manual_review_count=0` 时批次才可进入终态：若 `failed_count=0`、`manually_resolved_count=0` 且没有其他 issue，则为 `COMPLETED`；只要 `failed_count>0`、`manually_resolved_count>0` 或存在其他需保留提示的终态结果，则为 `COMPLETED_WITH_ISSUES`。产品层不限制批次总订单数，但 append/process 均使用有界 chunk。

### 10.6 `print_jobs`

每个订单每次明确打印意图对应一个 job：

| 字段                                                     | 语义                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                     | 主键                                                                                                                                    |
| `batch_id`                                               | 所属批次                                                                                                                                |
| `order_id`                                               | 订单                                                                                                                                    |
| `printer_id`                                             | 目标打印机                                                                                                                              |
| `sequence`                                               | 同订单人工打印次数序号                                                                                                                  |
| `idempotency_key`                                        | 当前人工请求幂等键，唯一                                                                                                                |
| `status`                                                 | `PENDING`、`SUBMITTING`、`ACCEPTED`、`FAILED`、`UNKNOWN`、`MANUAL_REVIEW`、`MANUALLY_CONFIRMED_PRINTED`、`MANUALLY_CLOSED`、`CANCELLED` |
| `payload_json`                                           | 创建时的不可变服务端小票 payload；创建满 180 天按第 16.2 节清除 PII                                                                     |
| `payload_hash`                                           | canonical payload SHA-256，脱敏后仍保留                                                                                                 |
| `vendor_job_id`                                          | 厂商任务号，可空                                                                                                                        |
| `vendor_error_code`                                      | 脱敏厂商错误码，可空                                                                                                                    |
| `accepted_at`                                            | 厂商明确接受时间，可空；不表示物理出纸时间                                                                                              |
| `created_by_admin_id`                                    | 操作管理员                                                                                                                              |
| `manual_resolution_by_admin_id` / `manual_resolution_at` | 人工收敛操作者与时间，可空                                                                                                              |
| `supersedes_job_id`                                      | 知悉重复风险后再次打印所关联的原 job，可空                                                                                              |
| `created_at` / `updated_at`                              | UTC 时间                                                                                                                                |

同一个客户端请求重试只能命中同一 job。管理员主动再次打印必须创建新的 sequence；对人工未知项“知悉重复风险后再次打印”还必须关联原 job。

## 11. 可打印订单与小票

### 11.1 状态范围

允许：

- `NEW`
- `PROCESSING`
- `COMPLETED`

禁止：

- `CANCELLED`

服务端在真正提交前重新读取并校验订单状态。客户端先前选择不能绕过取消状态。

### 11.2 不可变 payload

只读取：

- `Order` 快照；
- `OrderItem` 快照；
- 当前打印次数和安全的门店展示配置。

不回查或信任：

- 实时商品名称、SKU 售价或会员折扣；
- 客户端提交的金额、地址、手机号或商品内容；
- 任意客户端 ESC/POS/HTML。

payload canonicalization 后计算 hash。金额均为整数分。

### 11.3 小票内容

打印：

- 店铺名称；
- 订单号和下单时间；
- 自提或配送；
- 商品名称、SKU、数量、单价和行金额；
- 商品合计、会员优惠、消费金抵扣和应付金额；
- 手机号脱敏为 `138****0000` 形式；
- 配送订单打印完整配送地址；
- 自提订单不打印配送地址；
- 顾客备注完整打印，但先 NFC 规范化、移除控制字符并按票宽换行；
- 打印次数、打印时间和脱敏操作员标识。

不打印：

- 完整手机号；
- JWT、微信 OpenID/UnionID；
- 芯烨云密钥或签名；
- 数据库内部敏感字段；
- 客户端提供的控制指令。

### 11.4 再次打印

- 具有历史 `ACCEPTED` 或人工确认已打印记录的订单可由管理员再次创建明确打印意图；
- 不强制填写补打原因或增加票面“补打”字样；
- 每次创建新的 job、idempotency key 和 sequence；
- `UNKNOWN`/`MANUAL_REVIEW` 必须先按第 12.5 节收敛，不能走普通再次打印绕过重复风险确认；
- 记录操作者、打印机、时间、厂商任务号和打印意图次数。

## 12. 单张与批量打印流程

### 12.1 打印机选择与在线缓存

- 提交前必须选择一台存在、未解绑且状态为 `ACTIVE` 的打印机；客户端上次选择若指向不存在、已解绑或非 `ACTIVE` 设备，必须自动清除；
- 客户端按管理员记住上次选择的打印机 ID，选择只保存在客户端偏好中，不改变服务端默认路由；
- 厂商在线状态缓存最多使用 30 秒；缓存年龄超过 30 秒时，提交前必须实时查询厂商；
- 实时查询失败、响应不可验证或无法确认在线时 fail closed，拒绝创建新的提交意图或把既有 `PENDING` job 转为 `SUBMITTING`；
- 明确离线时拒绝提交，不创建等待上线的任务；
- 在线状态只用于降低明确失败率，不能证明物理出纸；最终结果仍按厂商提交响应和第 12.5 节查询/人工分类。

### 12.2 单张打印

```text
选择订单和在线打印机
→ 客户端生成 Idempotency-Key
→ API 校验管理员、订单、设备及最多 30 秒在线状态
→ API 构造并持久化不可变 payload/job(PENDING)
→ 短事务条件更新 job 为 SUBMITTING 后提交
→ API 调用芯烨云（不包在数据库长事务中）
→ 保存 ACCEPTED、FAILED 或 UNKNOWN 分类
→ 返回结果
```

单张流程同样不自动重试 `UNKNOWN`。厂商明确接受只得到 `ACCEPTED`，不宣称小票已经物理出纸。

### 12.3 纯客户端拉动批次

服务端不得以定时任务、队列消费者或后台 worker 自动消费 `PENDING` 打印 job；只有管理员页面的显式请求推动批次：

1. 创建批次得到 `DRAFT`；`DRAFT` 只允许按有界 chunk append 订单，服务端去重、拒绝取消订单并为每项创建独立 `PENDING` job 和幂等键。
2. 管理员显式 seal 批次，条件更新 `DRAFT -> READY`。seal 后禁止 append；`RUNNING` 及其后状态均禁止 append。
3. 页面调用 process-next-chunk。服务端以条件更新认领批次，只有一个并发请求能将 `READY`/`PAUSED -> RUNNING` 并获得 60 秒 lease；其他并发 process 返回批次状态冲突。
4. 一次 process 最多认领并同步处理 20 个 `PENDING` job。每个 job 独立转为 `SUBMITTING` 并调用厂商，单项明确失败不阻塞本 chunk 后续项。
5. 当前请求完成时，若仍有 `PENDING`、`SUBMITTING`、`UNKNOWN` 或 `MANUAL_REVIEW` job，将批次置 `PAUSED` 并清 lease；有 `PENDING` 时页面可继续调用下一 chunk，`SUBMITTING`/`UNKNOWN` 则先按第 12.5 节查询收敛，`MANUAL_REVIEW` 必须等待管理员人工处置。只有所有 job 均进入终态时才计算 `COMPLETED` 或 `COMPLETED_WITH_ISSUES`。
6. 页面停止请求时不会再消费新 job。请求中断或 lease 过期后，批次对管理员显示 `PAUSED`；recovery 先收敛本次已进入 `SUBMITTING` 的 job，再释放/接管 lease，不得重复提交，然后由管理员手动继续。
7. 关闭或离开页面必须警告；重进后读取批次并由管理员点击继续，不自动恢复消费。

页面显示总数、待提交、提交中、厂商已接受、明确失败、状态未知、人工复核和已取消；不得使用“打印成功”表示物理出纸。

### 12.4 批次状态与取消

状态转移为：

- `DRAFT -> READY`：显式 seal；
- `DRAFT -> CANCELLED`：尚未 seal 即取消；
- `READY | PAUSED -> RUNNING`：唯一 process 请求取得 60 秒 lease；
- `RUNNING -> PAUSED`：仍有待处理项、请求停止或租约恢复完成；
- `RUNNING | PAUSED -> COMPLETED`：`classified_count=total_count`、`manual_review_count=0`、`failed_count=0`、`manually_resolved_count=0`，且没有其他 issue；
- `RUNNING | PAUSED -> COMPLETED_WITH_ISSUES`：`classified_count=total_count`、`manual_review_count=0`，且 `failed_count>0`、`manually_resolved_count>0` 或存在其他需保留提示的终态结果；
- 批次仍含 `MANUAL_REVIEW` 时只能保持 `PAUSED`，不得进入任何 batch 终态；管理员完成第 12.5 节人工处置后再重新计算终态；
- `READY | PAUSED -> CANCELLED`：执行取消后，所有未提交 `PENDING` job 已置 `CANCELLED`，且不存在未收敛的 `SUBMITTING`/`UNKNOWN`/`MANUAL_REVIEW`。

`COMPLETED`、`COMPLETED_WITH_ISSUES`、`CANCELLED` 是 batch 终态；其余 batch 状态均为非终态。取消批次不撤销 `ACCEPTED`，也不覆盖任何人工处置历史。`COMPLETED` 仅表示所有提交意图已分类，不保证物理出纸。

### 12.5 UNKNOWN 查询与人工状态

job 状态和处理规则为：

- `PENDING`：尚未调用厂商；
- `SUBMITTING`：调用正在进行或崩溃恢复尚未收敛；
- `ACCEPTED`：厂商明确接受；
- `FAILED`：厂商明确未接受；
- `UNKNOWN`：首次提交响应无法验证，等待主动查询；
- `MANUAL_REVIEW`：查询后仍持续未知，必须人工判断；
- `MANUALLY_CONFIRMED_PRINTED`：管理员确认纸面已打印；
- `MANUALLY_CLOSED`：管理员知悉无法确认及重复风险，并选择关闭原 job；
- `CANCELLED`：从未提交即被取消。

`ACCEPTED`、`FAILED`、`MANUALLY_CONFIRMED_PRINTED`、`MANUALLY_CLOSED`、`CANCELLED` 是 job 终态；`PENDING`、`SUBMITTING`、`UNKNOWN`、`MANUAL_REVIEW` 是非终态，因此都会阻止解绑。对 `UNKNOWN` 查询厂商状态：明确接受转 `ACCEPTED`；明确未接受转 `FAILED`；在规定查询次数/时间窗后持续未知则转 `MANUAL_REVIEW`，不能无限保持自动轮询。

`MANUAL_REVIEW` 只允许以下经确认和审计的操作：

1. **确认纸面已打印**：原 job 转 `MANUALLY_CONFIRMED_PRINTED`；
2. **确认未打印**：原 job 转 `FAILED`，之后如需打印，由管理员创建新的明确打印意图；
3. **知悉重复风险后再次打印**：原 job 转 `MANUALLY_CLOSED`，同时创建一个具有新 idempotency key、新 sequence 和 `supersedes_job_id` 的 `PENDING` job；两项变更和风险确认原子记录并审计。

含 `MANUAL_REVIEW` 的批次必须显示 issue；待所有 job 收敛后进入 `COMPLETED_WITH_ISSUES`。创建满 180 天已脱敏的旧 job 不得直接重试或从原 payload 再发；只能重新读取当前订单不可变快照并创建新的明确打印意图。

## 13. API 边界

所有跨应用 DTO 位于 `@bake-mall/contracts`。以下仅描述语义，路径可在实施计划中按现有模块习惯定稿。

### 13.1 顾客/管理员会话

- 顾客会话查询自身管理员资格；
- linked User active、未合并并具有微信 OpenID/UnionID 的有效 `OPERATOR` 使用 `mall-user` 会话换取 `mall-admin` 会话；
- 普通管理员通过规范化后的唯一 `AdminUser.loginPhone` 定位 OPERATOR，再以操作密码登录 Admin Web；
- 首次临时密码修改同时接收临时密码、新密码和确认值，成功后使旧受限 token 失效并直接返回新的完整 `mall-admin` 会话；
- 管理员操作密码二次验证由高风险接口内部完成，不返回可长期复用的“验证通过”布尔值。

### 13.2 用户管理

- 分页查询消费用户；
- 按手机号手动创建 placeholder；
- 手机号验证时执行 placeholder 合并或返回确定性人工处理冲突；合并成功直接返回 canonical User 的新完整 `mall-user` 会话；
- 超级管理员授予普通管理员；
- 超级管理员撤销普通管理员；
- 查询目标用户管理员状态。

### 13.3 打印机管理

- 列出已绑定设备及脱敏 SN；
- 发起绑定并打印纸面验证码；
- 提交或重发纸面验证码；
- 查询/刷新在线状态；
- 重新查询厂商关联；
- 确认删除并收敛补偿/解绑；
- 解绑；
- 更新显示名称。

### 13.4 打印

- 创建单张打印；
- 创建 `DRAFT` 批次；
- 仅向 `DRAFT` 分块加入订单；
- 显式 seal 为 `READY`；
- process 一次最多处理 20 个 job；
- 查询批次和 job；
- 手动继续 `PAUSED`；
- 取消尚未提交的批次项；
- 查询 `UNKNOWN` 厂商状态；
- 执行 `MANUAL_REVIEW` 三类人工处置；
- 对明确 `FAILED` 创建新的打印意图。

### 13.5 幂等

以下写操作必须要求 `Idempotency-Key` 或同等强度的请求 ID：

- 发起设备绑定；
- 提交或重发纸面验证码；
- 重新查询厂商关联与确认删除；
- 单张打印；
- 创建、append、seal、process 或取消批次；
- 对失败项或人工关闭项创建新打印意图；
- 人工确认未知项；
- 解绑设备。

相同 key 和相同规范化请求重放返回同一结果；相同 key 不同请求返回冲突。

## 14. Admin Web 设计

### 14.1 用户管理模块

- 用户列表、搜索、分页；
- 历史身份手机号与管理员登录手机号分别脱敏展示，并展示微信是否绑定；搜索完整 loginPhone 只用于服务端精确匹配，响应不回显完整号码；
- 手动添加历史身份手机号用户；
- 管理员状态；
- 超级管理员可见授予/撤销操作，只有已绑定微信身份的 User 可授权；
- 授权表单要求独立管理员登录手机号、当前超级管理员密码、临时操作密码及确认值；
- 普通管理员不渲染授权操作，API 同时拒绝越权。

### 14.2 打印机管理模块

- 设备名称、脱敏 SN、绑定状态、在线状态和最近检查时间；
- 绑定向导：SN → 操作密码 → `BINDING` → 等待纸面验证码 → 回填；
- 5 分钟倒计时和剩余尝试次数；
- 刷新在线状态；
- `BINDING`/`ERROR`/`UNBINDING` 提供“重新查询厂商关联”“重发验证码”“确认删除”中与当前阶段匹配的恢复操作；
- 操作密码 + 二次确认解绑；
- 明确展示厂商绑定冲突和人工处理指引。

### 14.3 订单打印

- 订单列表支持多选；
- 取消订单禁用打印；
- 选择一台存在、未解绑、`ACTIVE` 且在线状态已在 30 秒内确认的设备；
- 单张打印；
- 批次 append 后显式 seal，并由页面逐次 process 最多 20 项；
- 进度使用“厂商已接受”而非“打印成功”；展示明确失败、未知、人工复核、已取消和手动继续；
- `MANUAL_REVIEW` 提供确认已打印、确认未打印、知悉重复风险后再次打印；
- 页面离开保护；
- 打印意图次数和历史任务查看，不把 `ACCEPTED` 显示为物理出纸成功。

### 14.4 普通管理员受限后台

普通管理员登录后默认跳转订单列表，只开放由第 7 节 permission 白名单支持的：

- 订单查看与合法状态更新；
- 用户查看/添加；
- 打印机管理；
- 单张/批量打印与打印历史；
- 修改自己的操作密码。

Dashboard、订单导出、supply、supply-items、商品、分类、会员、购卡记录、首页、upload、管理员和角色导航、路由及 API 均不可访问。

## 15. 小程序管理员区

### 15.1 入口

- 小程序启动时可用 `wx.login` 自动取得一次性 code 并加载 H5；H5 登录页还提供显式微信登录按钮，经严格同源 return URL 校验进入原生页，code 仅存 App 内存并在匹配的 web-view `deliveryId` load 后消费；自动与显式路径共用应用级协调器且避免竞态重复兑换。
- 小程序加载顾客微信身份后直接查询管理员资格，不进入 `/pages/phone-auth/index?flow=admin`，也不调用 `getPhoneNumber`；
- 非管理员不显示管理入口；
- 已撤权管理员进入时 API 返回未授权并清理本地管理会话；
- `mustChangePassword=true` 时先进入修改密码页。

### 15.2 原生管理页面

至少包含：

- 全部订单列表和筛选；
- 订单详情；
- 用户列表和手动添加；
- 打印机列表、绑定、验证码、补偿恢复和解绑；
- 订单多选和纯客户端拉动批量打印；
- 批次进度、厂商已接受/失败/未知汇总、人工复核和手动继续；
- 修改管理员操作密码。

真实管理动作由原生页面直接调用 API，不通过 H5 `postMessage` 即时桥接。

### 15.3 测试版与花生壳

开发/体验阶段允许：

```text
小程序体验版
  → 花生壳有效 HTTPS
  → H5/Vite 与 /api 代理
  → 本地 NestJS API
  → 芯烨云 HTTPS API
```

要求：

- H5 和 API 对手机可达；
- 证书有效；
- 开发阶段可使用调试模式；
- 稳定体验版仍需配置 `web-view` 业务域名和必要 request 域名；
- 花生壳只用于测试，不视为生产部署方案；
- 芯烨云密钥仍只存在本地 API 的被忽略环境文件。

## 16. 审计、安全与隐私

### 16.1 必须审计

- 用户手动创建；
- 管理员授予、撤销、首次改密和普通改密；
- 公开管理员登录请求无论成功、失败或限流均不逐次写 `AuditLog`；失败 attempt 只在固定 bucket 中聚合；
- 首次改密、普通改密与高风险二次验证的成功、失败和限流逐次写脱敏 `AuditLog`；
- 打印机绑定发起、add/发送/补偿状态转移、验证码成功/失败/过期、厂商关联恢复和解绑；
- 单张和批量打印、seal、process、租约恢复和取消；
- 对明确失败创建新意图、未知状态查询、人工确认和知悉重复风险后再次打印；
- 权限拒绝。

审计不得包含：

- 明文密码；
- 完整验证码；
- `UserKEY` 或签名；
- 完整手机号；
- 完整 SN（使用脱敏值或内部 ID）；
- 完整配送地址或顾客备注。

### 16.2 PII 与 180 天留存

- 用户列表默认手机号脱敏；必要操作按既有权限最小化展示；
- 小票手机号脱敏，地址按配送需要完整打印；
- 厂商 payload 只包含打印所需字段；
- 每个 print job 从 `created_at` 满 180 天后必须执行不可逆 PII 清理，不因其仍为 `UNKNOWN` 或 `MANUAL_REVIEW` 而延期；
- 清理 `payload_json` 中完整配送地址、顾客备注、手机号及其他可识别个人的明细；保留 `order_id`、`payload_hash`、整数分金额汇总、设备 ID、操作者 ID、厂商 task/job ID、job 状态、人工处置和审计链；
- 清理任务必须幂等、可审计，并确保数据库备份/导出遵循同一 180 天目标；
- 脱敏后的旧 job 不能直接重试、重新提交或从残余 payload 还原 PII。若仍需打印，只能基于订单不可变快照创建具有新幂等键和 sequence 的新明确意图；
- 日志不记录完整小票内容。

### 16.3 厂商凭据

- 生产使用 secret manager；
- 本地只写入 `.env.development`；
- 示例文件只有占位符；
- 禁止客户端直连芯烨云签名接口；
- 任何错误响应均不能包含签名原文。

## 17. 错误处理

共享错误码至少覆盖：

- 用户手机号冲突；
- placeholder 合并含不可迁移财务事实、微信身份冲突或管理员唯一性冲突；
- 管理员不存在、已撤权、linked User 不存在/停用/已合并/失去微信身份或 permission 不足；
- 必须修改临时密码；
- 操作密码错误或验证限流；
- 打印机 SN 无效、已绑定、归属无法证明或厂商限制；
- 纸面验证码错误、过期或次数耗尽；
- 打印机不存在、已解绑、非 `ACTIVE`、离线或在线状态无法验证；
- 绑定/补偿/解绑状态待人工恢复；
- 订单已取消；
- 批次未 seal、不可 append、租约已占用或状态冲突；
- 解绑被非终态 batch/job 阻止；
- 厂商明确未接受；
- 厂商状态未知或需 `MANUAL_REVIEW`；
- 厂商限流或暂时不可用。

客户端必须区分可重试、不可重试和需人工确认，不显示原始厂商响应。

## 18. 并发与事务

### 18.1 用户和管理员

- 历史身份手机号 `User.phone` 与管理员 PC 登录号 `AdminUser.loginPhone` 分别规范化，并由各自数据库唯一索引保证；`User.orderContactPhone` 明确不唯一；
- 授权/撤权锁定目标 `User` 和关联 `AdminUser`；授权同时检查微信 OpenID/UnionID 资格，并以 `admin_users.login_phone` 唯一索引兜底并发 race；
- placeholder 合并按稳定顺序锁定 placeholder、source 微信 User 和双方关联管理员，所有迁移、管理员重挂及 source token 失效原子提交；重挂后若 canonical User 无微信身份，管理员资格检查 fail closed；
- 同一用户最多一个 `OPERATOR`，同一 `loginPhone` 最多一个管理员；
- linked User 停用、合并或微信身份被清理后，登录、exchange 和 guard 立即拒绝；订单联系号或历史身份手机号变化不更新管理员 tokenVersion；
- 公开 `SUPER_ADMIN`/`OPERATOR` 登录先锁定或原子更新 `HMAC(kind + normalized identifier)` 映射的固定 bucket；known 管理员再按固定锁序更新其精确窗口，known/unknown 均不能以并发请求绕过“前 5 次 401、第 6 次 429”；
- bucket 碰撞按共享计数产生更严格限制；公开登录成功只重置管理员精确窗口、不重置 bucket，公开失败不逐次写 `AuditLog`；
- 首次改密、普通改密和高风险二次验证只原子更新每管理员精确窗口，成功重置并逐次写脱敏 `AuditLog`；
- 撤权、改密和 tokenVersion 更新同事务提交。

### 18.2 打印机

- SN/PID 唯一索引在解绑历史上继续生效；同一 SN 同时绑定只有一个请求成功；
- 调用厂商前必须先提交本地 `BINDING` 或 `UNBINDING` 状态；任何厂商调用和验证码发送都不得与数据库长事务混在一起；
- 每次外部调用前后只使用短事务、条件更新和幂等键推进 `binding_stage`；
- 同一设备最多一个有效纸面验证 challenge，验证尝试次数条件更新；
- 解绑与新打印提交互斥，任一非终态 batch/job 引用都会阻止进入 `UNBINDING`；
- 厂商调用成功后本地提交崩溃由 reconciliation job 或管理员恢复操作查询并收敛；不得为同 SN 重复创建记录；
- reconciliation job 只处理设备关联状态，不得自动处理 `PENDING` 打印 job。

### 18.3 打印任务

- job 先持久化，再在短事务条件更新为 `SUBMITTING`，事务外调用厂商；
- `SUBMITTING` 崩溃恢复时查询厂商；无法证明明确接受或未接受时转 `UNKNOWN`，不得自动重发；
- 幂等键和请求 hash 唯一；
- `DRAFT` 只 append，seal 后禁止 append；批次 process 使用条件更新保证单一 60 秒 lease，一次最多 20 项；
- 服务端没有自动消费 `PENDING` 的定时任务、队列消费者或后台 worker；
- 同一批次每个订单独立状态；
- 汇总计数按 job 状态在事务中更新或可重算，`accepted_count` 不得命名或解释为物理打印成功；
- 不因部分失败回滚已经被厂商接受的任务。

## 19. 测试策略

### 19.1 共享 contracts

覆盖：

- 角色、八项 `OPERATOR` permission 白名单和打印机/batch/job 状态枚举；
- 管理员资格、受限/完整会话和打印 DTO；
- 批次/job 可辨识联合与人工处置请求；
- 非法角色、permission 或状态编译期断言；
- 错误码唯一性。

### 19.2 API 单元测试

覆盖：

- 手机号规范化、placeholder 合并判定、购物车同 SKU 合并和阻断财务事实；
- 管理员密码策略和 bcrypt；
- 首次改密必须提交三项密码值、旧受限 token 失效和新完整会话；
- 公开登录固定 1024 HMAC bucket 的 5 分钟窗口、前 5 次 `401`/第 6 次 `429`、known/unknown 响应一致、碰撞更严格、known 管理员精确窗口叠加但不提前改变公开响应，以及登录成功不重置 bucket；
- 首次改密、普通改密与高风险二次验证沿用每管理员 5 分钟 5 次精确窗口，成功重置并逐次写脱敏 `AuditLog`；公开登录失败只聚合 bucket，不逐次写审计；
- permission 默认 SUPER_ADMIN 与显式白名单 guard；
- 芯烨云签名、响应校验和错误映射；
- 绑定 add/验证码发送/删除补偿状态机和 reconciliation；
- 小票脱敏、控制字符、宽度和整数分；
- job 幂等、`ACCEPTED` 语义和 UNKNOWN 人工分类；
- batch seal、20 项 process、60 秒 lease、取消、部分失败和恢复；
- 180 天 PII 清理及脱敏后禁止直接重试。

### 19.3 API HTTP 与真实 MySQL

覆盖：

- `mall-user` / `mall-admin` 交叉拒绝；
- `OPERATOR.username=null`、独立 `AdminUser.loginPhone` 登录、唯一键 race 与 legacy OPERATOR 回填/停用，以及迁移现有 admin 为 `SUPER_ADMIN`；
- linked User 停用、合并或失去微信身份后登录/换会话/guard 立即拒绝；订单联系号和历史身份手机号变化不影响管理员 token；
- 普通管理员对白名单外所有既有 endpoint 被拒绝，包括 dashboard、订单导出、supply/supply-items、商品/分类/会员/购卡/首页/upload/admin-role；
- 用户并发创建与 placeholder 合并锁；
- 合并迁移微信身份、地址、购物车和管理员关联；财务事实、OpenID/UnionID 或唯一性冲突整笔回滚；
- 授权/撤权和 token 立即失效；
- 管理员验证并发限流：公开登录覆盖同 bucket 并发第 5/6 次边界、known/unknown 和碰撞标识符，以及 known 管理员 bucket/精确窗口双层更新；已认证验证覆盖同管理员精确窗口边界；
- 0010 `down` guard 覆盖固定 bucket 存在活动窗口/失败计数时拒绝回滚，且拒绝路径零 DDL、schema 快照不变；
- SN 并发唯一绑定、厂商成功后数据库崩溃恢复且不重复创建；
- 验证码过期、5 次失败、同绑定重发和成功一次性；
- 验证码明确发送失败的删除补偿，以及 UNKNOWN 转 `ERROR` 后三类恢复操作；
- 解绑被任一非终态引用阻止，取消只影响 `PENDING`，厂商删除失败不完成本地解绑；
- 单张打印重放和 30 秒在线缓存 fail closed；
- 大批次 append/seal/process、并发认领、租约过期、无后台消费、部分失败和手动继续；
- UNKNOWN 查询与三类 `MANUAL_REVIEW` 操作；
- 取消订单在提交前被拒绝；
- 临时 schema、用户和 grant 必须清理。

### 19.4 前端与小程序

覆盖：

- 普通用户不显示管理入口；
- 撤权后管理会话清理；
- 首次改密 gate；
- 普通管理员默认跳订单与严格白名单导航；
- 用户添加、placeholder 合并冲突和错误反馈；
- 打印机绑定倒计时、次数和补偿恢复操作；
- 不存在、解绑、非 `ACTIVE`、离线或在线不可验证设备阻止提交；
- 批量 append/seal、客户端连续拉动、离开警告、租约过期和重进后手动继续；
- 厂商已接受语义、明确失败新意图和未知项三类人工处置。

### 19.5 fake 芯烨云

本地 fake server 覆盖：

- 添加/删除设备；
- 设备在线/离线；
- 打印提交明确接受；
- 厂商明确未接受；
- timeout、连接中断和不可验证响应；
- 状态查询的明确接受、明确未接受和持续未知；
- add 已存在、验证码发送失败、删除补偿和关联查询；
- 重复请求；
- 限流；
- 不泄露签名。

### 19.6 真实验收

使用：

- 小程序体验版；
- 花生壳 HTTPS 测试前后端；
- 芯烨云开发者账号；
- 一台真实兼容云打印机。

验收：

1. SN/PID 绑定及 `BINDING -> PENDING_VERIFICATION -> ACTIVE`；
2. 纸面验证码 5 分钟和 5 次限制，同一绑定重发不删除厂商关联；
3. 验证码发送失败补偿、UNKNOWN 进入 `ERROR` 和管理员恢复操作；
4. 在线/离线识别、30 秒缓存和查询失败时拒绝新提交；
5. 单张订单得到厂商 `ACCEPTED`，界面不宣称物理出纸成功；
6. 已接受订单再次创建明确打印意图；
7. 100 张批量通过页面逐 chunk 拉动，单次最多 20 项且无后台自动消费；
8. 中途关闭小程序、租约过期后显示 `PAUSED` 并手动继续；
9. 部分明确失败和只为失败项创建新意图；
10. 厂商 timeout 后查询并进入 `MANUAL_REVIEW`，三类人工处置均可审计；
11. 非终态引用阻止解绑，取消只取消 `PENDING`，厂商删除失败不完成本地解绑；
12. 普通管理员撤权后 token 立即失效；linked User 停用、合并或微信身份失效后，登录、exchange 和现有 token guard 立即拒绝；手机号资料变化不影响管理员权限；
13. 小票手机号脱敏、配送地址、备注和金额正确；
14. 创建满 180 天的打印 payload PII 被清理且旧 job 不可直接重试。

## 20. 旧方案退役

只有第 21 节前七个阶段门全部通过，且第 19.6 节新路径真实验收完成后，才执行旧方案退役：

1. 删除 `apps/merchant-terminal/`；
2. 删除 Android/UTS/HBuilderX/adb/`apkanalyzer`/RAW TCP 依赖和脚本；
3. 从 workspace 验证和根脚本移除 merchant-terminal；
4. 删除旧 Android 打印 A–D 计划；
5. 删除 XP-58IIH 本地 TCP runbook 和 verified fixture 阶段门；
6. 删除或替换旧 Android 打印设计，确保本文成为唯一权威打印规格；
7. 将可复用的排版规则迁移到 API printing 模块并保留测试；
8. 更新 README、部署文档、生产环境模板和进度文件；
9. 不删除与现有小程序 H5 登录桥接有关的代码；
10. 不把退役 Android 代码作为云打印运行时依赖。

真实验收通过前保留当前 Android 路径，但不得继续扩大其产品范围。退役删除必须确认没有其他未完成工作依赖这些文件，并通过 `git status` 区分本任务文件与工作区既有改动。

## 21. 分阶段实施与阶段门

每一阶段完成定向自动测试和真实 MySQL 门禁后才能进入依赖它的下一阶段；旧 Android 路径必须等阶段八真实验收通过后退役。

### 阶段一：placeholder 用户合并

- 手动添加明确创建 placeholder；
- 手机号验证锁定 placeholder、source 微信 User 和关联管理员；
- canonical ID 固定为手机号 placeholder；
- 微信身份、地址、购物车合并及财务事实/OpenID/UnionID/唯一性冲突；
- source 统一停用并保留为 tombstone，canonical/source 的 `token_version` 同事务递增，旧 `mall-user` token 失效并写审计。

阶段门：自动合并与所有确定性拒绝路径在真实 MySQL 并发测试中原子成立，不产生静默双用户。

### 阶段二：OPERATOR 身份与 token

- `admin_users.username` 可空、角色约束及现有 admin 全量回填 `SUPER_ADMIN`；
- `OPERATOR.username=null`，使用唯一 `AdminUser.loginPhone` 登录；
- 只有 SUPER_ADMIN 可为具有微信身份的 User 显式配置 loginPhone 与临时密码并授权；撤权、受限会话、首次三字段改密和新完整会话保持；
- linked User 停用、合并或失去微信身份时登录/exchange/guard 立即拒绝；三类手机号变化不影响管理员 token；
- 公开登录使用固定 1024 HMAC bucket，known/unknown 仅按 bucket 对外返回前 5 次 `401`、第 6 次 `429`；known 管理员另叠加不提前改变公开响应的精确窗口；
- 首次改密、普通改密和高风险二次验证继续使用每管理员 5 分钟 5 次精确窗口并逐次脱敏审计，公开登录失败仅聚合 bucket。

阶段门：Admin Web 登录、小程序换会话、首次改密和所有即时失效路径通过 audience 与真实 MySQL 测试；并发验证固定 bucket 的 known/unknown 一致响应、碰撞更严格、成功不重置 bucket、精确窗口成功重置，以及 `down` guard 拒绝活动 bucket 时零 DDL。

### 阶段三：既有 endpoint permission 锁定

- 定义八项共享 permission 常量；
- 既有 admin endpoint 默认 `SUPER_ADMIN`；
- 仅显式 permission 开放 OPERATOR 白名单；
- 对 dashboard、订单导出、supply/supply-items、商品/分类/会员/购卡/首页/upload/admin-role 建立拒绝测试；
- Admin Web OPERATOR 默认跳订单。

阶段门：逐 endpoint allow/deny 清单通过 API 测试，不能从聚合、导出或上传路径绕过。

### 阶段四：芯烨云 adapter 与绑定

- 服务端配置、fake adapter 和打印机 schema；
- `BINDING`、验证码发送、删除补偿、`PENDING_VERIFICATION`、`ACTIVE`、`UNBINDING`、`ERROR` 状态；
- add 已存在归属证明、同绑定 challenge 重发和三类管理员恢复操作；
- reconciliation job 处理厂商成功/数据库提交崩溃，不自动处理打印 job；
- 30 秒在线缓存与查询失败 fail closed。

阶段门：绑定、补偿、崩溃恢复、并发同 SN、验证码和解绑 adapter 矩阵全部通过。

### 阶段五：单张打印

- 服务端小票 payload/rendering；
- 单项 batch/job schema 与 180 天 PII 清理；
- `PENDING -> SUBMITTING -> ACCEPTED | FAILED | UNKNOWN`；
- 幂等重放、订单/设备/在线复检和 `ACCEPTED` 非物理出纸语义。

阶段门：fake adapter 与真实设备均完成单张、再次打印、timeout 不盲重和小票内容验收。

### 阶段六：批量与人工复核

- `DRAFT` append、显式 seal、`READY`、单一 60 秒 lease、每次最多 20 项；
- 纯客户端逐 chunk 拉动、`PAUSED` 手动继续和无后台自动消费；
- 批次取消与解绑非终态引用门禁；
- UNKNOWN 查询、`MANUAL_REVIEW` 三类人工处置和 `COMPLETED_WITH_ISSUES`；
- accepted/failed/manual/cancelled 计数和审计。

阶段门：100 项批次、并发 process、页面关闭、租约过期、取消、部分失败、UNKNOWN 和解绑竞态全部通过。

### 阶段七：Admin Web 与小程序 UI

- Admin Web 用户管理、严格受限后台、打印机恢复和单张/批量打印；
- 小程序管理入口、改密、用户管理、打印机绑定/恢复和打印；
- “厂商已接受”语义、人工复核、离开警告和手动继续；
- permission 与状态驱动导航，不以隐藏菜单替代 API 授权。

阶段门：前端/小程序自动测试及体验版端到端流程通过。

### 阶段八：新路径真实验收与 Android 退役

- 花生壳 + 小程序体验版 + 真实芯烨云打印机完成第 19.6 节全部验收；
- 先记录新路径验收通过，再执行第 20 节 Android 退役；
- 更新文档和环境模板，并确认 workspace 不再依赖旧终端。

阶段门：新路径真实验收证据完整、旧路径删除后全量门禁通过，本文正式成为唯一打印规格。

## 22. 验收标准

全部满足后才完成：

1. 单一小程序同时支持普通顾客和普通管理员，权限由 API 判定；
2. 超级管理员仍只使用 Admin Web；现有 admin 迁移为 `SUPER_ADMIN`；
3. Admin Web 和小程序均支持消费用户查看/添加，手工记录明确为 placeholder；
4. 手机号验证以 placeholder ID 为 canonical 原子合并安全数据；财务事实、微信身份和唯一性冲突被确定性阻断，不产生静默双用户；
5. `OPERATOR.username=null`，仅通过唯一 `AdminUser.loginPhone` 登录 PC；小程序只按 active、未合并且具有微信 OpenID/UnionID 的 linked User 换会话，不依赖 `User.phone`、`phoneVerified`、订单联系号或 `getPhoneNumber`；
6. 只有超级管理员能授予或撤销普通管理员；公开登录固定 1024 HMAC bucket 对 known/unknown 均为前 5 次 `401`、第 6 次 `429`，碰撞更严格，known 管理员附加精确窗口不提前改变响应，成功只重置管理员窗口且公开 attempt 不逐次写 `AuditLog`；首次改密三字段、已认证流程每管理员精确限流与逐次脱敏审计、新完整会话和所有 tokenVersion 即时失效事件生效；
7. OPERATOR 仅有八项 permission，既有 endpoint 默认 SUPER_ADMIN，所有白名单外路径被拒绝，Admin Web 默认跳订单；
8. 多台芯烨云打印机可绑定，单次只选择一台；绑定在厂商调用前持久化 `BINDING`；
9. 纸面验证码 5 分钟、最多 5 次且只存 hash；过期/耗尽在同一绑定重发，不删除厂商关联；
10. 验证码发送失败补偿、UNKNOWN/崩溃 reconciliation、add 已存在归属证明和管理员恢复操作均可收敛，且同 SN 不重复创建；
11. 不存在、已解绑、非 `ACTIVE`、离线或在线状态超过 30 秒且实时查询不可验证的设备不能提交；
12. 所有非取消订单可单张或批量打印，取消订单被拒绝；`ACCEPTED` 只表示厂商接受，不表示物理出纸；
13. 批次无产品数量上限，但 `DRAFT` 仅 append、显式 seal、客户端每次拉动最多 20 项、单一 60 秒 lease、无后台自动消费，并支持 `PAUSED` 手动继续；
14. 取消批次只取消 `PENDING`；任何设备非终态引用阻止解绑，厂商删除失败不完成本地解绑；
15. UNKNOWN 明确查询后转 `ACCEPTED`/`FAILED`/`MANUAL_REVIEW`，三类人工处置完整审计，含 issue 批次归为 `COMPLETED_WITH_ISSUES`；
16. 小票手机号脱敏、地址和备注规则正确，金额来自不可变快照；创建满 180 天清除 payload PII，UNKNOWN/MANUAL_REVIEW 不例外且旧 job 不可直接重试；
17. 厂商密钥只在服务端，timeout/UNKNOWN 不盲目重复打印；
18. 真实设备完成绑定、补偿恢复、单张、100 张批量和人工复核验收；
19. 只有新路径真实验收后才退役 Android/HBuilderX/UTS/TCP 旧方案；
20. contracts、API、Admin、小程序、真实 MySQL 和 E2E 相关门禁全部通过。
