# 订单小票打印与 Android 商家终端设计

## 1. 背景

`bake-mall` 已具备可靠的商品订单事务、不可变订单快照、创建幂等、商家后台订单详情与状态流转。门店计划使用芯烨 XP-58IIH 58mm 网络热敏打印机，在新订单创建后自动打印小票，并允许管理员手动打印、失败重试和有审计记录的补打。

该打印机位于门店局域网，通常通过原始 TCP 发送 ESC/POS 字节。普通 H5 无法打开任意 TCP Socket，也无法在 Android 后台或锁屏时可靠运行。因此，本设计新增独立的 uni-app Android 商家终端：应用内嵌现有 Admin H5，Android 原生前台服务负责领取打印任务，UTS 原生插件负责连接打印机。

本设计必须保护以下既有约束：

- 订单、订单项、金额、履约与会员信息均以创建时的不可变快照为准；
- 金额继续使用整数分，不使用浮点数参与计算；
- 订单创建幂等重放不得重复创建自动初打任务；
- 打印成功或失败不得隐式改变订单状态；
- 管理员身份、顾客身份与打印设备身份严格隔离；
- 打印机 TCP 端口只存在于可信门店局域网，不向公网暴露。

## 2. 目标与范围

### 2.1 目标

1. 新订单与自动初打任务在同一个 MySQL 事务中原子提交。
2. Android 商家终端在前台、后台和锁屏状态下均可自动领取并打印任务。
3. Admin H5 支持查看打印状态、立即重试、人工确认和补打。
4. 多个已配对终端同时在线时，正常任务不会被并发重复领取。
5. 网络、打印机或 App 故障后任务不丢失，并按结果确定性选择重试或人工确认。
6. 真实芯烨 XP-58IIH 能正确打印中文、商品、金额、履约信息、备注和补打标记。
7. 设备凭据只保存在 Android 原生安全存储中，不暴露给 WebView。

### 2.2 首期范围

- 单商家、单打印目标；
- 芯烨 XP-58IIH 网络打印机；
- 58mm 顾客/制作共用订单小票；
- 每个任务串行打印，默认一份；
- 自动初打；
- 手动触发尚未完成的初打任务；
- 有原因、有操作者、有明显票面标记的补打；
- Android 设备配对、停用、心跳与撤销；
- MySQL 持久任务、租约、回执、退避重试和人工确认；
- Android Foreground Service、启动恢复、本地打印 ledger；
- 打印机 IP、端口、编码、纸宽、走纸和切刀能力诊断；
- Admin H5 打印状态、设备状态和人工恢复入口。

### 2.3 非首期范围

- iOS 后台自动打印；
- 浏览器直接连接打印机；
- 云打印厂商平台；
- 多门店、多租户和管理员角色权限；
- 多打印机路由、厨房单、标签单和多联单；
- 拖拽式或任意 HTML 模板编辑器；
- 商品图片、复杂 Logo、自定义字体；
- 钱箱控制；
- 将 `payableTotalCents` 表述为已支付或实收金额；
- 物理层严格 exactly-once 承诺；
- 为打印任务新增 Redis、BullMQ、Kafka、RabbitMQ 或 WebSocket 消息总线。

## 3. 总体架构

```text
顾客 H5
  POST /orders + Idempotency-Key
            │
            ▼
OrdersService 单一 MySQL 事务
  ├─ 锁定业务资源并校验报价
  ├─ 条件扣库存、扣消费金
  ├─ 写 orders 和 order_items
  ├─ 自动打印启用时写唯一 INITIAL/AUTO print_job + 不可变 payload
  └─ 完成订单幂等记录
            │
          COMMIT
            │
            ▼ HTTPS claim/lease/ack
Android uni-app 商家终端
  ├─ 内嵌 Admin H5
  ├─ mall-device 身份
  ├─ Foreground Service
  ├─ 本地打印 ledger
  ├─ ESC/POS formatter
  └─ UTS TCP printer adapter
            │
            ▼ 门店局域网原始 TCP
       芯烨 XP-58IIH
```

### 3.1 API 职责

- 保存设备、打印任务、尝试记录和不可变小票 payload；
- 在订单事务内创建唯一自动初打任务；
- 提供设备配对、设备 token、任务认领、租约心跳和结果回执；
- 以数据库锁和租约协调多个终端；
- 提供 Admin 打印状态、重试、人工确认、补打和设备管理接口；
- 记录操作者、设备、错误码、任务和补打原因；
- 不连接门店打印机，不依赖进程内队列。

### 3.2 Admin H5 职责

- 保留现有订单列表、详情和状态流转；
- 展示订单打印状态、设备、时间、失败原因和尝试历史；
- 发起初打重试、人工确认和补打；
- 管理配对码和设备启停；
- 通过受限桥接打开终端设置、打印测试页和启停本地服务；
- 不获取设备 credential，不构造可信小票金额，不发送任意 ESC/POS 字节。

### 3.3 Android 商家终端职责

- 内嵌生产环境 Admin H5；
- uni-app Vue/JS 层只负责配对输入、设置、诊断控制、状态展示和 WebView，不运行后台轮询或真实订单打印状态机；
- Android UTS/Kotlin Foreground Service 独立保存和使用设备身份，即使 WebView/JS Runtime 被销毁也能工作；
- 原生服务独立完成短期 token 获取、HTTPS claim/heartbeat/start/ack/recover、轮询和网络退避；
- 原生服务维护 app-private ledger，处理进程重启和 ACK 恢复；
- 原生服务根据服务端 payload 和本机打印机能力生成 ESC/POS，连接局域网打印机并发送完整字节；
- 原生服务向 API 回报明确成功、明确失败或结果不确定；
- 跨端 wire schema 由 `@bake-mall/contracts` 单一维护，构建时生成 UTS 类型和验证器，禁止人工维护第二套设备 DTO。

### 3.4 打印机职责

- 仅接受门店局域网终端连接；
- 按真实自检页确认的端口和 ESC/POS 能力工作；
- 未验证切刀能力前只走纸，不发送切纸指令；
- 不通过路由器端口映射暴露到公网。

## 4. 数据模型

所有新表遵循现有 schema 约定：InnoDB、`utf8mb4_unicode_ci`、`BIGINT UNSIGNED` 主键、UTC `DATETIME`、显式索引和版本化迁移。

### 4.1 `print_devices`

记录 Android 商家终端，不代表物理打印机。

| 字段                        | 语义                               |
| --------------------------- | ---------------------------------- |
| `id`                        | 设备主键                           |
| `name`                      | 管理员可识别名称，如“门店收银平板” |
| `status`                    | `ACTIVE`、`DISABLED`               |
| `credential_hash`           | 长期设备凭据哈希，不保存明文       |
| `token_version`             | 撤销该设备全部旧 token 的版本      |
| `platform`                  | 首期固定 `ANDROID`                 |
| `app_version`               | 最近上报的 App 版本                |
| `last_seen_at`              | 最近设备心跳时间                   |
| `created_at` / `updated_at` | UTC 时间                           |

打印机 IP、端口、编码等首期配置保存在设备本地。服务端可保存脱敏后的诊断摘要和能力信息，但不向 H5 返回设备 secret。

### 4.2 `print_pairing_codes`

| 字段                    | 语义                                 |
| ----------------------- | ------------------------------------ |
| `id`                    | 配对记录主键                         |
| `code_hash`             | 六位配对码或二维码随机 secret 的哈希 |
| `requested_by_admin_id` | 创建配对码的管理员                   |
| `expires_at`            | 创建后 5 分钟失效                    |
| `consumed_at`           | 一次性消费时间，可空                 |
| `failed_attempts`       | 错误次数，用于限流                   |
| `created_at`            | UTC 时间                             |

配对码一次性使用，服务端不保存明文，连续错误请求必须限流。

### 4.3 `print_settings`

首期为单商家单例配置，固定 `id=1`，由 Admin 修改并使用 `version` 乐观锁。

| 字段                        | 语义                                             |
| --------------------------- | ------------------------------------------------ |
| `id`                        | 固定为 1                                         |
| `auto_print_enabled`        | 新订单是否在事务内创建自动初打任务，默认 `false` |
| `merchant_name`             | 小票商家名称                                     |
| `store_name`                | 门店名称，可空                                   |
| `store_phone`               | 门店联系电话，可空                               |
| `store_address`             | 门店地址，可空                                   |
| `footer_text`               | 小票页脚，可空                                   |
| `business_time_zone`        | 首期默认 `Asia/Shanghai`                         |
| `template_version`          | 首期固定 `receipt-58-v1`                         |
| `default_copies`            | 首期固定为 1                                     |
| `version`                   | Admin 乐观锁版本                                 |
| `updated_by_admin_id`       | 最近修改管理员                                   |
| `created_at` / `updated_at` | UTC 时间                                         |

`auto_print_enabled` 的默认值必须为 `false`。只有至少一台 `ACTIVE` 设备在最近 60 秒内心跳正常，且该设备已上报打印机诊断通过，Admin 才能启用自动打印。启用不回填或打印开关开启前的历史订单；关闭后新订单不创建自动任务，已经存在的任务继续按原状态处理，除非管理员逐条暂停或确认。

### 4.4 `print_jobs`

| 字段                        | 语义                          |
| --------------------------- | ----------------------------- |
| `id`                        | 打印任务主键                  |
| `order_id`                  | 订单外键                      |
| `kind`                      | `INITIAL`、`REPRINT`          |
| `trigger`                   | `AUTO`、`MANUAL`              |
| `generation`                | 初打固定为 0，补打从 1 递增   |
| `status`                    | 打印状态机                    |
| `payload_version`           | payload schema 版本，首期为 1 |
| `template_version`          | 首期为 `receipt-58-v1`        |
| `payload_json`              | 完整不可变打印快照            |
| `payload_hash`              | 规范化业务 payload 的 SHA-256 |
| `copies`                    | 首期默认 1                    |
| `attempt_count`             | 已开始的尝试次数              |
| `max_attempts`              | 自动安全重试上限              |
| `available_at`              | 下次允许认领时间              |
| `leased_by_device_id`       | 当前认领设备，可空            |
| `lease_token_hash`          | 当前随机租约 token 哈希，可空 |
| `lease_expires_at`          | 当前租约过期时间，可空        |
| `printed_at`                | 终端确认完整发送时间，可空    |
| `requested_by_admin_id`     | 自动触发为空，手动触发必填    |
| `reprint_reason_code`       | 补打原因枚举，可空            |
| `reprint_reason_text`       | “其他”说明，可空              |
| `last_error_code`           | 结构化错误码，不含 PII        |
| `last_error_message`        | 脱敏错误摘要                  |
| `created_at` / `updated_at` | UTC 时间                      |

关键约束：

```text
UNIQUE(order_id, generation)
INDEX(status, available_at, id)
INDEX(leased_by_device_id, lease_expires_at)
INDEX(order_id, created_at)
```

启用自动打印时，新订单初打固定为 `INITIAL + AUTO + generation=0`。订单幂等重放、服务重试或并发请求不得创建第二条初打任务。

自动打印关闭且某订单尚无任务时，管理员首次点击打印创建 `INITIAL + MANUAL + generation=0`；启用自动打印不补打更早的订单。已经完成或经人工确认的初打再次打印时，每次创建新的 `REPRINT + MANUAL`，其 `generation` 在订单行锁保护下递增。补打不得修改或复用历史任务，且必须包含管理员和补打原因。

### 4.5 `print_attempts`

| 字段                         | 语义                                  |
| ---------------------------- | ------------------------------------- |
| `id`                         | 尝试主键                              |
| `print_job_id`               | 打印任务                              |
| `device_id`                  | 执行设备                              |
| `attempt_no`                 | 任务内递增序号                        |
| `outcome`                    | `SENT`、`FAILED`、`UNCERTAIN`         |
| `error_code`                 | 结构化错误码                          |
| `rendered_bytes_hash`        | 实际发送 ESC/POS 字节的 SHA-256，可空 |
| `duration_ms`                | 尝试耗时                              |
| `started_at` / `finished_at` | UTC 时间                              |

`started_at` 由设备进入发送阶段时的 API 事务使用服务端时钟写入，并作为本次票面的“打印时间”。尝试记录不复制完整手机号、地址、设备 token 或 payload。

## 5. 打印任务状态机

```text
PENDING ──claim──> LEASED ──start──> SENDING ──完整发送──> PRINTED
   ▲                 │                    │
   │                 ├─租约过期───────────┘（LEASED 可安全回收）
   │                 ├─发送前明确失败──> RETRY ──到期──┘
   │                                      ├─结果不确定/租约过期──> NEEDS_CONFIRMATION
   │                                      └─永久失败/超过上限────> DEAD
   └──────────────Admin 安全重试──────────────────────────────────
```

### 5.1 状态语义

- `PENDING`：等待设备领取。
- `LEASED`：某台设备持有有效租约，但尚未调用 `start`，协议禁止向打印机写入任何字节。
- `SENDING`：设备已调用 `start` 并可能开始写入打印机；租约过期时结果不确定。
- `RETRY`：已明确没有出纸或尚未开始发送，等待安全重试。
- `PRINTED`：终端确认完整 ESC/POS 数据已写入打印机连接。
- `NEEDS_CONFIRMATION`：可能已经出纸，但没有可靠业务回执，禁止盲目自动重打。
- `DEAD`：永久失败或超过自动安全重试次数，需要管理员处理。

`PRINTED` 不代表系统从物理传感器确认纸张完整出纸。UI 和文档统一使用“终端已发送”或“已打印”运营状态，不宣称硬件级 exactly-once。

### 5.2 错误分类

可安全重试：

- `DEVICE_API_OFFLINE`
- `PRINTER_CONNECT_TIMEOUT`
- `PRINTER_CONNECTION_REFUSED`
- `PRINTER_HOST_UNREACHABLE`
- `PAYLOAD_BUILD_FAILED`（仅在临时错误时）
- `LEASE_EXPIRED_BEFORE_SEND`

结果不确定：

- `PRINTER_CONNECTION_LOST_DURING_WRITE`
- `APP_RESTARTED_WHILE_SENDING`
- `SOCKET_WRITE_FINISHED_ACK_MISSING`
- `LOCAL_LEDGER_CORRUPT`

永久失败：

- `UNSUPPORTED_PAYLOAD_VERSION`
- `UNSUPPORTED_PRINTER_CAPABILITY`
- `DEVICE_REVOKED`
- `PAYLOAD_HASH_MISMATCH`
- `INVALID_RECEIPT_SNAPSHOT`

### 5.3 重试退避

明确失败按以下间隔重试：

```text
2 秒 → 5 秒 → 15 秒 → 30 秒 → 60 秒
```

达到自动重试上限后进入 `DEAD`。网络恢复可提前唤醒符合安全重试条件的任务，但不得绕过不确定状态。

## 6. 订单事务与打印任务原子性

打印任务必须使用订单事务中的同一个 `EntityManager` 写入。推荐顺序：

```text
保存 order
保存 order_items
锁定并读取 print_settings
若 auto_print_enabled=true：生成 PrintReceiptPayloadV1 并插入唯一 INITIAL/AUTO print_job
清理购物车
完成订单 idempotency response snapshot
提交
```

必须满足：

- 订单失败或库存回滚时不产生打印任务；
- 自动打印启用时，有已提交的新订单就有一个 `INITIAL/AUTO` 任务；自动打印关闭时，新订单不创建任务；
- 相同订单幂等重放只返回已有响应，不创建新任务；
- API 在事务提交后立即崩溃也不会丢失已经决定创建的任务；
- 不使用提交后的内存事件做唯一任务来源；
- 自动打印启用时，打印任务创建失败必须让订单事务整体回滚，不允许产生“应自动打印的订单成功但没有任务”的静默状态。

打印任务是订单下单成功的可靠 outbox，但打印结果不属于订单事务，也不改变订单状态机。

## 7. 任务认领、租约与回执

### 7.1 认领

设备调用：

```http
POST /api/v1/device/print-jobs/claim
Authorization: Bearer <mall-device-token>
```

API 在 MySQL 事务中：

1. 选择 `PENDING`、到期 `RETRY` 或租约已过期的 `LEASED`；
2. 使用行锁和 `SKIP LOCKED` 避免多设备领取同一任务；
3. 写入设备 ID、随机 lease token 哈希和过期时间；
4. 返回任务 payload、payload hash 和明文 lease token；
5. 不在数据库保存明文 lease token。

设备协议禁止在 `LEASED` 状态向打印机写入任何字节，因此过期 `LEASED` 可以安全回收。设备完成 TCP 连接但尚未写入前，必须调用 `/start`；API 在单一事务中把任务改为 `SENDING`、创建 attempt、使用服务端时钟写入 `started_at` 并返回 `startedAt`。只有 `start` 成功后才能渲染该次打印时间并写入打印机。

过期 `SENDING` 不能被普通 claim 接管，必须进入 `NEEDS_CONFIRMATION`，或由原认领设备通过 `/recover` 携带本地 ledger 证据恢复：本地 `SENT` 只允许补 ACK，本地 `SENDING` 保持人工确认。其他设备不得自动打印过期 `SENDING`。

首期一个设备一次只领取一条任务并串行打印。

### 7.2 租约心跳

```http
POST /api/v1/device/print-jobs/:id/heartbeat
```

只有当前设备和正确 lease token 可以延期。处于本地 `SENDING` 阶段时必须持续维护租约，避免任务在发送中被另一设备回收。

### 7.3 开始发送

```http
POST /api/v1/device/print-jobs/:id/start
```

只有当前设备和正确 lease token 可以调用。API 必须以条件更新确认任务仍为该租约的 `LEASED`，再原子改为 `SENDING`、递增 `attempt_count`、创建本次 `print_attempt` 并返回服务端 `startedAt`。调用成功前，设备不得写入任何打印字节；调用成功后，设备先用 `startedAt` 渲染票面打印时间，再将本地 ledger 改为 `SENDING` 并开始写入。

### 7.4 回执

```http
POST /api/v1/device/print-jobs/:id/ack
```

ACK 包含：

```json
{
  "leaseToken": "一次性租约令牌",
  "result": "SENT",
  "attemptNo": 1,
  "durationMs": 836,
  "errorCode": null
}
```

要求：

- 旧 lease token 不能修改新租约；
- 同一成功 ACK 重复提交必须幂等；
- 明确失败按错误分类进入 `RETRY` 或 `DEAD`；
- 结果不确定进入 `NEEDS_CONFIRMATION`；
- 回执事务同时更新 job 和写 attempt。

## 8. 设备身份与配对

### 8.1 身份隔离

系统新增第三种 audience：

```text
mall-user      顾客
mall-admin     管理员
mall-device    打印终端
```

Android 后台服务不得复用 Admin JWT。设备 token 只能访问：

- `/device/auth/*`
- `/device/heartbeat`
- `/device/print-jobs/*`

设备身份不能访问商品编辑、管理员配置、任意用户查询或订单状态修改。

### 8.2 配对流程

```text
管理员创建 5 分钟一次性配对码/二维码
→ Android 原生层输入或扫描
→ API 事务性验证并消费配对码
→ API 生成 256-bit 随机设备 credential、登记设备并只返回一次
→ credential 立即写入 Android Keystore，Vue/JS 不持有持久副本
→ 配对码立即失效
```

要求：

- 配对码仅存哈希、一次性、5 分钟失效；
- 错误尝试限流；
- 长期 credential 只在成功配对时返回一次；
- 服务端只保存 credential 哈希；
- 原生层用 credential 换取短期 `mall-device` token；
- 每次鉴权检查设备 `ACTIVE` 和 `token_version`；
- 管理员停用设备后，设备不能再 claim、heartbeat 或 ACK；
- device credential 和 token 不进入 WebView、URL、JS 日志或 localStorage。

## 9. 不可变小票 payload

共享契约新增版本化的 `PrintReceiptPayloadV1`。payload 在任务创建时固化：

- `payloadVersion = 1`
- `templateVersion = receipt-58-v1`
- `businessTimeZone`
- 商家名称、门店名称、电话、地址和页脚快照
- 任务短编号
- 自动初打或补打信息
- 订单号和下单时间
- 履约类型、联系人、电话、自提时间或配送地址
- 商品名称、SKU 名称、属性、单价、数量、行原价、行会员优惠、行折后金额
- 商品总额、会员优惠、消费金抵扣、应付金额
- 会员名称和折扣快照
- 买家备注

payload 生成后计算规范化 SHA-256。服务端、Android 本地 ledger 和 ACK 使用同一 hash，防止任务 ID 与业务内容意外错配。`payload_hash` 不包含每次尝试才确定的打印时间；设备进入发送阶段后，API 使用服务端时钟创建 attempt 并返回 `startedAt`，formatter 将该时间渲染为票面的“打印时间”，并把最终 ESC/POS 字节哈希通过 ACK 写入 `rendered_bytes_hash`。

小票不得回查实时商品名称、实时价格、实时会员配置或实时地址覆盖历史快照。商家抬头来自 `print_settings`，并在任务创建时快照化，保证历史补打可追溯。

## 10. 58mm 小票模板

### 10.1 一期模板

```text
              烘焙商城
--------------------------------
订单号：BM2026080200001234
下单时间：2026-08-02 14:35
履约方式：门店自提
取货时间：今天 17:00
--------------------------------
草莓奶油蛋糕
  6寸 / 少糖           x1   68.00
巧克力曲奇
  12片装                x2   50.00
--------------------------------
商品合计                     118.00
会员优惠                      -8.80
消费金抵扣                   -20.00
应付金额                      89.20
--------------------------------
联系人：张三
手机：138****0000
备注：蛋糕写“生日快乐”
--------------------------------
打印时间：2026-08-02 14:35:08
任务编号：P8X2K7
        请按约定时间准备商品
```

配送订单打印完整配送地址；是否打印完整手机号由用途策略决定：自提默认脱敏，配送小票允许完整手机号。API 日志、错误摘要和历史列表始终脱敏。

### 10.2 金额语义

当前订单没有完整支付状态、支付时间和支付渠道。因此小票只能使用：

```text
应付金额
```

不得使用：

```text
已支付
实收金额
支付渠道
支付时间
```

`linePayableCents` 只包含行会员优惠，不包含订单级消费金分摊。小票在订单汇总区单独打印消费金抵扣，不虚构商品行最终实付。

### 10.3 自动初打、手动初打与补打

- 新订单自动初打不额外打印“初打”字样。
- 自动打印关闭且订单从未创建打印任务时，管理员首次点击打印创建 `INITIAL/MANUAL + generation=0`。
- 初打任务处于 `PENDING` 或 `RETRY` 时，管理员“立即打印”只提前其 `availableAt`，不创建新任务。
- 初打任务处于 `DEAD` 时，管理员确认问题已排除后可以重置同一任务的安全重试状态；历史 attempts 保留。
- `LEASED` 不允许管理员直接重复触发；租约过期后先进入 `NEEDS_CONFIRMATION`。
- 初打已 `PRINTED` 或经人工确认已打印后，再次打印必须创建 `REPRINT/MANUAL`。
- 补打票顶部打印“补打小票”、补打次数和原因。
- 补打原因支持：缺纸、卡纸或内容不完整、原票遗失、顾客要求、其他；“其他”必须填写说明。

### 10.4 排版规则

- 实际列数由真机 PoC 确认，不把 58mm 固定等同于某个字符数；
- 打印机能力记录半角列数、编码、字体比例、走纸行数和切刀支持；
- ASCII 显示宽度按 1，中文和全角字符按 2；
- 不使用 JavaScript `string.length` 直接做对齐；
- 商品名、属性、备注和地址按显示宽度换行；
- 数量和金额优先右对齐；
- 过滤 ESC/POS 控制字符和不可打印字符；
- 不打印商品图片；
- 未验证切刀能力前 `supportsCut=false`，只走纸后手撕。

## 11. Android 商家终端

建议新增 `apps/merchant-terminal`：

```text
pages/
  terminal/              Admin H5 容器
  pairing/               设备配对
  printer-settings/      打印机配置
  diagnostics/           连接和测试
bridge/
  admin-web/             受限 H5 桥接
scripts/
  generate-uts-wire.mjs  从 contracts schema 生成 UTS wire 类型
uni_modules/
  bake-print-runtime/    UTS/Kotlin 原生设备 API、worker、ledger、formatter、TCP
```

### 11.1 原生 Foreground Service

Foreground Service、worker、设备 HTTPS client、ledger、formatter 和 TCP adapter 必须位于 UTS/Kotlin 原生模块中。只从 uni-app JS 启动一个空前台服务、同时继续依赖 JS `setInterval`/Promise 循环领取任务，不满足本设计；Android 回收 WebView 或 JS Runtime 后，原生服务必须仍可独立完成一次完整的 claim→start→print→ack。

启动前提：

- 已配对且设备为 `ACTIVE`；
- 打印机配置通过诊断；
- 店员显式启用自动打印；
- Android 通知权限满足前台服务要求。

运行时持续显示系统通知，例如：

```text
烘焙商城打印服务
状态：运行中 · 打印机已连接
```

App 页面关闭、WebView 未加载、App 位于后台或设备锁屏时，服务继续领取任务。用户在系统中强行停止 App 后无法保证自行恢复，App 下次打开必须明确告警。

### 11.2 原生任务处理循环

首期由 Foreground Service 内的 UTS/Kotlin worker 使用 HTTPS 轮询；Vue 页面是否挂载不影响该循环：

```text
验证设备身份
→ 检查本地配置
→ claim 一条任务
→ 保存 RECEIVED
→ 校验 payload hash 与 capability
→ 连接打印机但不写入字节
→ 调用 API start，获取服务端 startedAt
→ 原生渲染 ESC/POS
→ 标记 SENDING
→ 写入完整字节
→ 标记 SENT
→ ACK API（含 renderedBytesHash）
→ 标记 ACKED
```

- 空闲时每 3 秒查询；
- 有待处理任务时立即领取下一条；
- 网络连续失败逐步退避至 60 秒；
- 网络恢复时立即查询；
- 每个任务采用“连接、发送、关闭”，首期不维护永久打印机连接；
- 一次只打印一条，避免内容交错。

### 11.3 原生本地打印 ledger

ledger 与 lease token 由原生服务直接访问：metadata 使用 app-private 原子存储，credential/lease token 使用 Android Keystore。Vue/JS 只能读取脱敏的聚合状态，不能读取任务 lease token 或修改 ledger。

本地持久化：

```text
jobId
payloadHash
leaseToken（安全存储）
state: RECEIVED | SENDING | SENT | ACKED
receivedAt
sentAt
ackedAt
```

重启恢复：

| 状态       | 行为                     |
| ---------- | ------------------------ |
| `RECEIVED` | 重新确认租约后继续       |
| `SENDING`  | 上报不确定，等待人工确认 |
| `SENT`     | 只重试 ACK，不重新出纸   |
| `ACKED`    | 不再处理，按保留策略清理 |

### 11.4 打印机配置和诊断

本地配置：

```text
host
port
paperWidth = 58
encoding
charactersPerLine
connectTimeoutMs
writeTimeoutMs
feedLines
supportsCut
```

保存前必须完成：

1. IP 和端口校验；
2. TCP 连接；
3. 英文测试；
4. 中文测试；
5. 中英文宽度和金额对齐；
6. 长商品名、备注和地址换行；
7. 走纸；
8. 人工确认完整出纸；
9. 可选切刀测试。

编码候选由真机验证，优先 GB18030/GBK；不无限开放任意代码页或任意 ESC/POS 指令。

### 11.5 ESC/POS 与 TCP 边界

原生业务 formatter：

```text
renderReceipt(payload, startedAt, capabilities) → ByteArray
```

UTS/Kotlin printer adapter：

```text
connect(host, port, timeout)
write(bytes)
queryStatusIfSupported()
close()
```

formatter 不负责网络，TCP adapter 不负责订单金额和业务文案。两者都由原生 worker 调用，耗时操作在 Android IO dispatcher/thread 执行。Node/Vitest 可以保留同算法的纯参考实现和 golden fixture，用于快速反馈，但发布产物的后台打印不得回调 JS formatter。

### 11.6 Contracts 到 UTS 的生成边界

`@bake-mall/contracts` 是设备 wire contract 的单一事实来源。共享包导出版本化、无函数的 JSON schema/manifest，至少覆盖 pair/token/heartbeat、claim/start/ack/recover、`PrintReceiptPayloadV1`、状态和错误码。`apps/merchant-terminal/scripts/generate-uts-wire.mjs` 根据该 manifest 生成 `uni_modules/bake-print-runtime/utssdk/app-android/generated/printing-wire.uts` 及验证器。

生成文件不得手工编辑；CI 必须重新生成并执行 diff check，证明 contracts 变化已同步。原生服务收到 JSON 后先按生成 validator 校验，再转为内部不可变模型。不得为方便手工复制一套名称相同但独立演进的 UTS DTO。

## 12. H5 与原生桥接

只开放白名单：

- `GET_TERMINAL_STATUS`
- `OPEN_PRINTER_SETTINGS`
- `PRINT_TEST_PAGE`
- `START_PRINT_SERVICE`
- `STOP_PRINT_SERVICE`

禁止：

- 连接任意 TCP 地址；
- 发送任意字节；
- 读取 device credential 或 Keystore；
- 执行任意原生方法；
- 由 H5 提供真实订单金额或完整可信小票内容。

消息包含：

```text
messageId
action
payload
timestamp
```

原生层必须校验 H5 来源域名、action 白名单、字段 schema 和时间窗口；重复 `messageId` 幂等响应；测试打印限频。

真实订单初打、重试和补打全部通过 API 的持久任务系统完成，不通过桥接直接出纸。

## 13. Admin 交互

订单详情新增打印区：

```text
打印状态：已打印
打印设备：门店收银平板
打印时间：14:35:08

[打印/重试] [补打小票] [查看打印记录]
```

| 状态                 | 展示与操作                 |
| -------------------- | -------------------------- |
| `PENDING`            | 等待打印，可立即调度       |
| `LEASED`             | 正在打印，禁止重复操作     |
| `RETRY`              | 显示脱敏原因和下次重试时间 |
| `PRINTED`            | 可创建补打任务             |
| `NEEDS_CONFIRMATION` | 可标记已打印或确认重新打印 |
| `DEAD`               | 提示检查设备后重试         |
| 无在线设备           | 明确告警，但任务保留       |

人工确认必须写入管理员审计。将 `NEEDS_CONFIRMATION` 标为已打印不会产生新纸张；确认重新打印必须创建新的补打任务并填写原因。

Admin 设备页支持：

- 创建配对码/二维码；
- 查看设备在线状态、App 版本和最近心跳；
- 重命名、停用和撤销设备；
- 查看待处理、失败和待确认任务数量；
- 不显示 device credential。

## 14. API 边界

### 14.1 Admin API

```http
POST   /admin/print-devices/pairing-codes
GET    /admin/print-devices
PATCH  /admin/print-devices/:id
DELETE /admin/print-devices/:id

GET  /admin/orders/:id/print-jobs
POST /admin/orders/:id/print-jobs/retry
POST /admin/orders/:id/print-jobs/reprints
POST /admin/print-jobs/:id/confirm-printed
```

补打请求必须带原因。`retry` 只允许安全恢复尚未完成的初打任务，不能把 `PRINTED` 任务重置成待打印。

### 14.2 Device API

```http
POST /device/auth/pair
POST /device/auth/token
POST /device/heartbeat
POST /device/print-jobs/claim
POST /device/print-jobs/:id/heartbeat
POST /device/print-jobs/:id/start
POST /device/print-jobs/:id/ack
POST /device/print-jobs/:id/recover
```

所有跨 API、Admin 和 Android 的 DTO、枚举及可辨识 payload 均定义在 `@bake-mall/contracts`，不得在各应用重复定义。

## 15. 网络与安全

终端同时访问：

```text
互联网 HTTPS → bake-mall API
门店 LAN TCP → XP-58IIH
```

要求：

- API 通信只使用 HTTPS；
- 打印机端口不映射公网；
- 建议打印终端和打印机处于可信门店 Wi-Fi 或隔离 VLAN；
- device secret 使用 Android Keystore；
- H5 只加载批准的 Admin HTTPS 域名；
- bridge 校验来源；
- 订单 PII 仅下发给已配对且 `ACTIVE` 的设备；
- API 日志、attempt 和审计摘要不记录完整手机号、地址或 payload；
- 设备撤销立即禁止后续 claim/heartbeat/ack；
- `print_jobs.payload_json` 和 attempts 默认在线保留 180 天；到期任务先生成不含 PII 的审计摘要，再清空 payload 中的联系人、手机号和地址；订单不可变快照仍按订单自身保留策略保存，历史打印记录继续保留状态、时间、设备、模板版本、hash 和错误码。

## 16. 物理 exactly-once 限制

以下窗口无法由普通原始 TCP 打印机完全消除：

```text
打印机已经出纸
→ App 在上报成功前崩溃
→ API 不知道是否真实出纸
```

系统采用：

- 服务端任务唯一性和租约；
- Android 本地 ledger；
- payload hash；
- `SENT` 只补 ACK，不重新出纸；
- `SENDING` 恢复为 `NEEDS_CONFIRMATION`；
- 小票打印任务短编号；
- 补打有明显标记和原因；
- 不确定结果必须人工处理。

系统保证任务持久化和正常并发不重复领取，但不承诺物理层严格 exactly-once。

## 17. 测试策略

### 17.1 共享契约

- 打印任务、设备、尝试和补打原因枚举；
- `PrintReceiptPayloadV1` 版本可辨识；
- 自动初打和补打字段约束；
- 非法金额、不完整履约快照和非法状态由类型或运行时校验拒绝。

### 17.2 API 单元测试

- payload 只使用订单不可变快照；
- 商家抬头和模板版本被快照；
- 整数分格式化和订单金额不变量；
- 自动任务唯一性；
- 补打 generation 递增且原因必填；
- 设备撤销后不能领取或 ACK；
- 错误和审计不泄露 PII。

### 17.3 真实 MySQL 测试

- 订单与自动打印任务同事务提交；
- 库存、消费金或订单失败时不产生任务；
- 相同订单幂等重放只有一个自动任务；
- 两台设备并发 claim 只有一台成功；
- `LEASED` 可安全回收、`SENDING` 过期转人工确认；
- `/start` 条件更新、attempt 创建和服务端打印时间原子提交；
- 旧 lease token 不能 start、heartbeat 或 ACK；
- 重复成功 ACK 幂等；
- 补打并发 generation 唯一；
- job 与 attempt 原子更新；
- 临时测试 schema、用户和 grant 被清理。

### 17.4 Android/UTS 测试

通过 fake TCP server 验证：

- 正确 IP、端口和超时；
- ESC/POS 字节完整一致；
- GB18030/GBK 中文编码；
- 中英文显示宽度、长文本和金额对齐；
- 连接失败、中途断开和 write 后 ACK 失败分类；
- 本地 ledger 重启恢复；
- Foreground Service 生命周期；
- H5 bridge 白名单和来源校验；
- device credential 不暴露给 WebView。

### 17.5 真机验收

必须使用实际 XP-58IIH：

1. 自检页确认 IP、端口和能力；
2. 中文无乱码；
3. 58mm 对齐正确；
4. 长商品名、备注和地址正确换行；
5. 金额数值和右对齐正确；
6. 自提与配送模板正确；
7. 控制字符不能破坏打印指令；
8. App 前台自动打印；
9. App 后台自动打印；
10. 手机锁屏后自动打印；
11. 打印机断电后任务不丢；
12. Wi-Fi 恢复后安全续打；
13. App 重启后 ledger 正确恢复；
14. 多设备不并发重复领取；
15. 补打有明显标记、操作者和原因；
16. 不确定状态不盲目重打。

## 18. 分阶段实施

### 阶段一：设备 PoC

- 创建最小 Android uni-app/UTS 测试应用；
- 配置打印机 IP 和端口；
- fake TCP 和真实打印机测试；
- 验证中文编码、58mm 列数、长文本、走纸和切刀；
- 不接真实订单自动任务。

### 阶段二：可靠任务基础

- 共享 printing 契约；
- `print_devices`、`print_pairing_codes`、`print_settings`、`print_jobs`、`print_attempts`；
- 订单事务内自动任务；
- 配对和 `mall-device` 鉴权；
- claim、lease、heartbeat、ack、retry、recover；
- MySQL 并发与回滚测试。

### 阶段三：完整 Android 商家终端

- 内嵌 Admin H5；
- Foreground Service；
- 本地 ledger；
- 断网和重启恢复；
- 配置和诊断页；
- 开机恢复与电池优化引导。

### 阶段四：Admin 运营闭环

- 订单详情打印状态；
- 立即重试、人工确认和补打；
- 设备管理与配对；
- 打印历史和失败告警；
- Android 窄屏 WebView 适配。

### 阶段五：真机和运行时验收

- 完成真机验收矩阵；
- 验证后台、锁屏、断网、断电、重启和多设备；
- 编写门店安装、Wi-Fi、打印机自检、电池设置和故障排查 runbook。

## 19. 验收标准

功能完成必须同时满足：

- 订单与自动初打任务原子提交；
- 订单幂等重试不重复创建自动任务；
- Android 前台、后台和锁屏均可自动领取任务；
- 打印机离线期间任务不丢；
- 多终端正常并发不重复领取；
- 真机中文、58mm 排版和走纸正确；
- Admin 可查看状态、重试、补打和处理不确定结果；
- 补打记录操作者、原因并在票面标记；
- `mall-admin` 与 `mall-device` 身份隔离；
- WebView 无法获取设备密钥或发送任意打印指令；
- 所有金额和订单内容来自服务端不可变快照；
- 极端 ACK 窗口进入人工确认，不虚假承诺严格 exactly-once；
- API、共享契约、Admin、Android、真实 MySQL 和真机测试均通过；
- 部署与门店运维文档完整。
