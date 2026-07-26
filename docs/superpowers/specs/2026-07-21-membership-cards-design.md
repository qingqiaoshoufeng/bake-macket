# Bake Mall 会员卡与消费金设计规格

- **日期：** 2026-07-21
- **状态：** 已确认，实施中
- **范围：** 共享契约、NestJS API、MySQL 迁移、Admin 会员运营、H5 会员展示与购买、商品订单会员定价
- **关联规格：** `docs/superpowers/specs/2026-07-12-bake-mall-design.md`
- **2026-07-22 决策补充：** 同级有效期内续费直接延长当前会员，并以不可变有效期贡献记录保留每笔购买的区间来源；有效期内升级按目标等级全价支付并立即生效，不折算、退款或顺延低等级剩余天数。

## 1. 目标与范围

在单商家烘焙商城中增加独立会员域，形成以下闭环：

1. 商家在 Admin 配置多个会员等级；
2. 顾客在 H5“我的”页面浏览当前会员与全部可购等级；
3. 顾客进入会员详情并创建购卡单；
4. 开发/测试环境通过模拟支付完成购卡；
5. 购卡后立即获得有期限的会员折扣和永久有效的赠送消费金；
6. 商品结算时应用会员折扣，并允许顾客输入本单消费金抵扣额；
7. 订单、会员、额度和审计记录均可追溯且并发安全。

本阶段包含：

- 会员等级 CRUD、上下架、排序、卡面模板和运营预览；
- 单卡升级制、同级续费、禁止降购；
- 购卡订单、开发/测试环境模拟支付、发卡与赠送额度；
- 用户会员卡展示、横向滑动、详情与购买确认；
- 消费金账户、发放批次、扣减分配、不可变流水与冲正；
- 全商品会员折扣、订单报价、消费金抵扣和订单金额快照；
- 商品订单取消时返还本单消费金，仍不回补库存；
- 权益完全未使用时由管理员作废购卡；
- 幂等、审计、权限隔离和并发控制。

本阶段不包含：

- 真实微信支付、支付回调、退款到账、对账或支付渠道管理；
- 用户自助购卡退款；
- 按比例购卡退款；
- 消费金提现、转赠、购买会员卡或兑换现金；
- 商品/分类级会员折扣排除；
- 多张生效会员卡或多等级折扣叠加；
- 积分、成长值、任务体系、生日礼自动发放；
- 生产环境模拟支付。

## 2. 已确认业务规则

### 2.1 会员卡

- 每个用户同时最多有一个当前会员等级；`member_accounts.active_membership_id` 必须直接指向当前时间有效且状态为 `ACTIVE` 的记录，不能指向未来才生效的记录。
- 同级有效期内续费按该等级本次购买的完整价格付款，不允许消费金抵扣；不创建新的 `user_memberships`，而是从当前 `endsAt` 顺延本次购买快照的 `validDays`，并创建不可变有效期贡献记录。
- 续费后的新周期沿用当前 `user_memberships` 的权益与折扣快照；等级配置变化仅影响首次开卡、过期后重新购买和跨等级升级。续费购买单仍完整保存当次配置快照，用于价格、赠送额度和审计追溯，但不在续费中途切换当前权益。
- 同级会员已过期后重新购买，从支付成功时间开始并创建新的当前会员记录；旧记录转为 `EXPIRED`。
- 购买更高 `rank` 等级为立即升级：按目标等级完整价格付款，支付成功时间为唯一切换点；旧会员截止并转为 `REPLACED`，新会员从该时刻起按新等级快照生效。
- 当前会员有效时禁止购买更低 `rank` 等级；会员过期后可按新购卡购买任意上架等级。
- 升级不折算旧卡已支付金额，不退款，不补偿或顺延低等级剩余天数；低等级已续到未来但尚未使用的天数随升级失效。
- 消费金不能用于购买、续费或升级会员卡。升级与续费只追加新赠送额度，不清空原有消费金。
- 等级配置修改只影响规则明确允许采用新快照的未来购买；已经生效的会员周期使用其 `user_memberships` 快照。
- 会员到期后停止折扣，但已获得的消费金仍可使用。

### 2.2 赠送消费金

- 购卡成功后一次性发放 `grantCreditCents`。
- 消费金永久有效、不能提现、不可转赠、不可用于购买或续费会员卡。
- 升级或续费只追加新额度，不清空或延长已有额度。
- 商品结算时由用户输入本单期望抵扣金额。
- 服务端实际使用金额：

```text
min(用户输入金额, 当前可用余额, 会员折后应付金额)
```

- 余额不足或并发变化时不得透支；报价与下单结果不一致时返回明确冲突并要求刷新报价。
- 商品订单取消时原路返还本单实际使用的消费金；重复取消不得重复返还。

### 2.3 折扣

- 首期全部可售商品参与会员折扣。
- 折扣使用整数基点：`10000 = 原价`、`9500 = 95 折`、`8800 = 88 折`。
- 每个订单行独立计算并四舍五入到分：

```text
linePayableCents = floor((lineGoodsCents × discountBasisPoints + 5000) / 10000)
lineDiscountCents = lineGoodsCents - linePayableCents
```

- 先计算会员折扣，再抵扣消费金。
- 前端只提交购物车项和消费金使用意图，不提交可信价格、折扣率或最终优惠。

### 2.4 购卡支付与作废

- 购卡使用独立购买单，不复用商品订单。
- 首期支付渠道只有 `SIMULATED`，仅在 API 明确启用开发/测试开关时可执行。
- 生产环境不展示模拟支付按钮，API 也必须拒绝模拟支付。
- 不提供用户自助退款。
- 管理员仅可作废权益完全未使用、且位于当前会员链末端的购卡记录。
- 作废时冲销该次剩余赠送消费金并恢复购卡前会员状态；所有变化与审计同事务提交。

## 3. 架构与模块边界

### 3.1 共享契约

新增 `packages/shared-contracts/src/membership.ts`，统一导出：

- `MembershipLevelStatus`
- `MembershipTheme`
- `MembershipStatus`
- `MembershipPurchaseStatus`
- `MembershipPaymentStatus`
- `MemberCreditEntryType`
- `PublicMembershipLevelView`
- `AdminMembershipLevelListItem`
- `AdminMembershipLevelDetailView`
- `SaveMembershipLevelRequest`
- `CurrentMembershipView`
- `MembershipAccountView`
- `MembershipOverviewView`
- `MembershipPurchaseView`
- `CreateMembershipPurchaseRequest`
- `OrderQuoteRequest` / `OrderQuoteView`

跨 API、H5、Admin 的 DTO 不在应用内重复定义。

### 3.2 API 模块

新增独立 `MembershipModule`：

```text
apps/api/src/membership/
├── membership.module.ts
├── membership.service.ts
├── membership-pricing.service.ts
├── membership-credit.service.ts
├── admin-membership.controller.ts
├── public-membership.controller.ts
├── customer-membership.controller.ts
└── dto/
```

依赖方向：

```text
MembershipModule
  ├── 管理等级、购卡、持卡、消费金和报价权益
  ├── 使用 AuditModule 记录后台变更
  └── 向 OrdersModule 提供事务内定价和消费金额度操作

OrdersModule
  ├── 仍负责库存、商品订单和购物车清理
  └── 不解释会员配置，只消费会员服务返回的权威定价结果
```

会员等级不写入 JWT。商品下单必须在数据库内解析当前有效会员。

### 3.3 前端模块

Admin 新增独立 `membership-cards` 和 `membership-purchases` feature；H5 新增 `membership` feature。组件、hooks、api、config、type、mock 按项目强制目录规范拆分。

## 4. 数据模型

所有新表遵循：

- `BIGINT UNSIGNED` 主键；
- 金额为 `INT UNSIGNED` 分；
- UTC `DATETIME`；
- `utf8mb4` / `utf8mb4_unicode_ci`；
- `synchronize: false`，通过新迁移创建；
- 外键删除策略优先 `RESTRICT`，历史资金和订单记录不可级联删除。

### 4.1 `membership_levels`

| 字段                                | 说明                                     |
| ----------------------------------- | ---------------------------------------- |
| `id`                                | 主键                                     |
| `code`                              | 唯一稳定标识，创建后不可改               |
| `name` / `subtitle` / `description` | 展示文案                                 |
| `rank`                              | 唯一业务等级，决定升级/降购              |
| `price_cents`                       | 购卡价格                                 |
| `grant_credit_cents`                | 赠送消费金                               |
| `discount_basis_points`             | 1000–10000                               |
| `valid_days`                        | 1–3650                                   |
| `benefits`                          | 有序权益 JSON；仅展示，不存可消费余额    |
| `theme`                             | `PEARL`、`CHAMPAGNE`、`JADE`、`OBSIDIAN` |
| `badge_text`                        | 卡面徽标短文案                           |
| `sort_order`                        | 展示顺序                                 |
| `is_active`                         | 是否可购买                               |
| `version`                           | 乐观锁版本                               |
| `created_at` / `updated_at`         | UTC 时间                                 |

已产生购买记录的等级不可物理删除；只能下架。

### 4.2 `member_accounts`

每用户唯一：

| 字段                        | 说明               |
| --------------------------- | ------------------ |
| `user_id`                   | 唯一用户外键       |
| `active_membership_id`      | 当前会员记录，可空 |
| `available_credit_cents`    | 消费金汇总余额     |
| `version`                   | 并发扣款版本       |
| `created_at` / `updated_at` | UTC 时间           |

汇总余额用于高效读取；所有变化必须同时写入账本并满足余额守恒。

### 4.3 `membership_purchase_orders`

| 字段                                   | 说明                               |
| -------------------------------------- | ---------------------------------- |
| `purchase_no`                          | 唯一购卡单号                       |
| `user_id` / `membership_level_id`      | 用户与配置引用                     |
| 等级、价格、额度、折扣、天数、卡面快照 | 配置变更不影响历史                 |
| `status`                               | `PENDING`、`FULFILLED`、`VOIDED`   |
| `payment_status`                       | `PENDING`、`SUCCEEDED`、`REVERSED` |
| `payment_channel`                      | 首期仅 `SIMULATED`                 |
| `idempotency_key`                      | 用户内唯一                         |
| `request_hash`                         | 同 key 不同请求冲突                |
| `paid_at` / `voided_at`                | 可空时间                           |
| `created_at` / `updated_at`            | UTC 时间                           |

### 4.4 `user_memberships`

首次开卡、过期后重新购买和跨等级升级创建新记录；同级有效期内续费延长当前记录，不新增记录：

| 字段                                | 说明                                      |
| ----------------------------------- | ----------------------------------------- |
| `user_id` / `purchase_order_id`     | 归属与首次创建该会员记录的购买来源        |
| `membership_level_id`               | 配置引用                                  |
| 等级 code/name/rank/discount 等快照 | 该连续会员周期内使用的历史权益依据        |
| `starts_at` / `ends_at`             | 当前聚合有效区间 `[start, end)`           |
| `previous_membership_id`            | 跨等级升级或重新开卡前的记录，可空        |
| `status`                            | `ACTIVE`、`REPLACED`、`VOIDED`、`EXPIRED` |
| `created_at` / `updated_at`         | UTC 时间                                  |

有效会员必须同时满足：账户指针指向该记录、状态为 `ACTIVE`、当前时间位于 `[startsAt, endsAt)`。任何写路径都不得让账户指针指向未来区间或已过期记录。

### 4.5 `membership_entitlement_segments`

`0006` 迁移新增不可变有效期贡献表。每笔成功购卡恰好对应一条 segment，用于证明该 purchase 为哪一条会员记录贡献了哪段时间，并支持精确作废：

| 字段                          | 说明                                               |
| ----------------------------- | -------------------------------------------------- |
| `membership_id`               | 被创建或延长的 `user_memberships`                  |
| `purchase_order_id`           | 唯一购买来源；一笔成功购卡只能贡献一次             |
| `kind`                        | `INITIAL`、`RENEWAL`、`UPGRADE`                    |
| `starts_at` / `ends_at`       | 该购买贡献的有效区间 `[start, end)`                |
| `previous_membership_id`      | 升级前会员，可空                                   |
| `previous_membership_ends_at` | 升级前原始到期时间，用于作废升级时恢复；非升级为空 |
| `created_at`                  | UTC 时间                                           |

约束：`ends_at > starts_at`；`purchase_order_id` 唯一；三个外键均 `ON DELETE RESTRICT`；`membership_id` 与 `purchase_order_id` 使用 `ON UPDATE CASCADE`，`previous_membership_id` restore 外键固定使用 `ON UPDATE RESTRICT`。MySQL 8.4 errno 3823 禁止 previous restore 外键列同时参与 upgrade restore CHECK 与 `ON UPDATE CASCADE`，且会员主键不可变，因此不尝试 CASCADE fallback。segment 不复制等级权益、价格或额度快照，这些仍以购买单为权威。

同级续费只允许追加当前会员的链尾 segment，且必须满足 `segment.startsAt === membership.endsAt`。作废续费只允许撤销链尾 segment，并把会员 `endsAt` 回退到该 segment 的 `startsAt`。

### 4.6 `member_credit_grants`

虽然消费金永久有效，仍按来源批次记录，支持精确作废：

| 字段                               | 说明                              |
| ---------------------------------- | --------------------------------- |
| `account_id` / `purchase_order_id` | 账户与来源                        |
| `granted_cents`                    | 发放额度                          |
| `remaining_cents`                  | 当前剩余额度                      |
| `status`                           | `ACTIVE`、`EXHAUSTED`、`REVERSED` |
| `created_at` / `updated_at`        | 时间                              |

扣款按创建时间 FIFO 分配到 grant；这样可以判断某一购卡赠送额度是否已被使用，并可精确冲销未用额度。

### 4.7 `member_credit_entries`

不可变流水：

| 字段                              | 说明                                       |
| --------------------------------- | ------------------------------------------ |
| `account_id`                      | 账户                                       |
| `direction`                       | `CREDIT`、`DEBIT`                          |
| `type`                            | 发放、商品扣款、订单取消返还、购卡作废冲销 |
| `amount_cents`                    | 正整数                                     |
| `balance_after_cents`             | 变更后余额                                 |
| `reference_type` / `reference_id` | 业务引用                                   |
| `operation_key`                   | 唯一，保证幂等                             |
| `reversal_of_entry_id`            | 冲正原流水，可空                           |
| `created_at`                      | 创建时间                                   |

流水不更新、不删除；返还或作废通过新流水表达。

### 4.8 `member_credit_allocations`

记录一笔商品订单扣款或返还如何对应 grant 批次：

- `credit_entry_id`
- `grant_id`
- `amount_cents`

订单取消时根据原扣款 allocation 恢复各 grant，保证守恒。

### 4.9 商品订单扩展

订单头保留 `goods_total_cents`，新增：

- `membership_discount_cents`
- `credit_applied_cents`
- `payable_total_cents`
- `membership_id`
- 等级 code/name/discount 快照
- `pricing_version`

订单项新增：

- `line_goods_total_cents`
- `line_membership_discount_cents`
- `line_payable_cents`

数据库与服务端共同保护：

```text
payable_total_cents = goods_total_cents - membership_discount_cents - credit_applied_cents
0 <= membership_discount_cents <= goods_total_cents
0 <= credit_applied_cents <= goods_total_cents - membership_discount_cents
```

## 5. 状态机与原子流程

### 5.1 购卡

```text
Purchase: PENDING → FULFILLED → VOIDED
Payment:  PENDING → SUCCEEDED → REVERSED
```

创建购卡单只保存快照，不发卡、不入账。模拟支付成功事务使用统一锁顺序：用户 → 会员账户 → 购卡单 → 当前会员 → 有效期贡献 → grant → 流水。

1. 校验环境允许模拟支付并锁定用户、账户和购卡单；
2. 校验购卡单仍为 `PENDING`，目标等级仍上架；
3. 解析当前时间有效会员并锁定记录；
4. 当前会员有效且目标 `rank` 更低时拒绝降购；
5. 同级有效期内续费：锁定当前链尾 segment，追加 `RENEWAL` segment，并把当前会员 `endsAt` 延长到新 segment 的 `endsAt`；状态和账户指针保持不变；
6. 过期后购买：将旧记录置 `EXPIRED`，从支付成功时间创建新的当前会员及 `INITIAL` segment；
7. 有效期内升级：按目标等级完整价格立即生效；记录旧会员原始 `endsAt`，将旧会员截止到支付时间并置 `REPLACED`，创建新会员及 `UPGRADE` segment，账户指向新会员；低等级剩余和未来已续天数不折算、不退款、不顺延；
8. 通过 `MembershipCreditService` 创建消费金 grant、增加账户余额并写唯一发放流水；
9. 将支付和购买状态更新为成功；
10. 提交。

任何购卡支付都不接受消费金抵扣。相同购卡单的并发支付只能创建一次会员/segment、一次 grant 和一条发放流水。

相同幂等键重复请求返回同一购卡单；同 key 不同 request hash 返回 `409`。

### 5.2 购卡作废

仅当以下条件同时成立：

- 购买单为 `FULFILLED` 且未作废；
- 该购买对应当前会员或其有效期贡献的链尾；
- 该 grant 的 `remainingCents === grantedCents`；
- 购卡生效后没有已创建商品订单使用该会员快照；
- 对升级作废，前一会员的恢复信息完整；
- 对续费作废，该 segment 是当前会员最后一段有效期贡献。

作废使用与支付、商品订单一致的锁顺序：账户 → 当前会员 → segment → grant → 原发放流水。所有资格必须在锁内重新读取和判断，禁止使用锁前读取的 grant 作为权威值。

事务中：

- 通过 `MembershipCreditService` 锁定 grant，冲销未使用额度、扣减账户余额并写反向流水；反向流水的 `reversalOfEntryId` 必须指向原发放流水；
- 同级续费作废：将当前会员 `endsAt` 回退到该 `RENEWAL` segment 的 `startsAt`，并保留同一当前会员记录；
- 首次开卡作废：将对应会员置 `VOIDED`，账户指针置空或恢复仍有效的前一记录；
- 升级作废：将新会员置 `VOIDED`；将旧会员 `endsAt` 恢复为 segment 保存的原始到期时间。作废时旧会员仍有效则恢复为 `ACTIVE` 并更新账户指针，已经过期则置 `EXPIRED` 且账户指针置空；
- 标记购买单与支付已冲销并写审计；
- 任一步失败时整体回滚。

### 5.3 商品报价

`POST /orders/quote` 使用当前购物车项和消费金输入意图：

- 在服务端读取实时 SKU、当前会员和账户余额；
- 返回行级原价、会员优惠、折后价；
- 返回最大可抵扣、实际预估抵扣、最终应付；
- 返回短期 `quoteToken`，绑定用户、购物车项、数量、价格版本、会员版本、余额版本和过期时间。

报价不扣库存、不扣额度，不保证最终成交；用于 UI 明确展示和减少下单冲突。

### 5.4 商品下单

创建订单请求新增：

- `requestedCreditCents`
- `quoteToken`

同一事务内：

1. 验证幂等键、request hash 和 quote token；
2. 锁定购物车、SKU、会员账户和当前会员；
3. 重新计算所有金额；
4. 若价格、会员或余额版本与报价不一致，返回 `409 ORDER_QUOTE_STALE`；
5. 条件扣减库存；
6. 以 FIFO 扣减 grant 与账户余额，写扣款流水和 allocations；
7. 创建订单及所有价格/会员快照；
8. 清除本次购物车项；
9. 提交。

### 5.5 商品订单取消

保持现有订单状态机和“不回补库存”规则。若订单使用消费金，在取消事务中：

- 检查唯一冲正 operation key；
- 根据原 allocations 恢复 grant；
- 增加账户余额；
- 写 `PRODUCT_ORDER_CANCEL_REVERSAL`；
- 更新订单状态并写审计；
- 提交。

### 5.6 Task 4.4 实现记录（2026-07-23）

支付履约已拆分为 `MembershipEntitlementService` 与 `MembershipCreditService`：支付事务在锁定用户后先锁/创建账户，再锁购卡单与支付幂等记录；权益服务在同一事务内锁当前会员及同级续费链尾 segment，随后才调用消费金额度发放。首次、过期重开与升级各创建一条新会员记录和对应 segment；同级续费只追加 `RENEWAL` segment 并延长既有会员，不改变该会员的权益快照或账户当前指针。成功 purchase 的任何支付 key 重试都由其唯一 segment 回查 `membershipId`，因此不得通过 `UserMembership.purchaseOrderId` 查询续费结果。

本记录不包含 Task 4.5 的作废恢复、Admin 详情或订单服务调用。

## 6. API 设计

### 6.1 Public / H5

```text
GET  /public/membership-levels
GET  /public/membership-levels/:id
GET  /me/membership
GET  /me/membership/purchases
GET  /me/membership/credit-entries
POST /me/membership/purchases
POST /me/membership/purchases/:id/simulate-payment   # 非生产开关
POST /orders/quote
POST /orders                                         # 扩展请求与响应
```

购买与支付请求要求 `Idempotency-Key`。商品报价要求登录；会员购买要求已验证手机号。

### 6.2 Admin

```text
GET    /admin/membership-levels
GET    /admin/membership-levels/:id
POST   /admin/membership-levels
PUT    /admin/membership-levels/:id
PATCH  /admin/membership-levels/:id/status
DELETE /admin/membership-levels/:id
GET    /admin/membership-purchases
GET    /admin/membership-purchases/:id
POST   /admin/membership-purchases/:id/void
```

### 6.3 错误码

新增：

- `MEMBERSHIP_LEVEL_NOT_FOUND`
- `MEMBERSHIP_LEVEL_INACTIVE`
- `MEMBERSHIP_DOWNGRADE_NOT_ALLOWED`
- `MEMBERSHIP_LEVEL_VERSION_CONFLICT`
- `MEMBERSHIP_PURCHASE_NOT_VOIDABLE`
- `SIMULATED_PAYMENT_DISABLED`
- `MEMBER_CREDIT_INSUFFICIENT`
- `ORDER_QUOTE_STALE`
- `IDEMPOTENCY_IN_PROGRESS`
- `IDEMPOTENCY_CONFLICT`

错误响应提供可展示中文 message 和结构化 details；不泄露数据库或堆栈。

## 7. Admin 体验

### 7.1 导航

新增：

```text
会员运营
├── 会员卡配置
└── 购卡记录
```

路由：

- `/membership-cards`
- `/membership-cards/new`
- `/membership-cards/:id/edit`
- `/membership-purchases`

### 7.2 会员卡配置列表

展示等级、code、rank、价格、赠送额度、折扣、有效天数、已售数量、状态、版本和更新时间。支持搜索、状态筛选、新建、编辑、上下架和卡面预览。

`rank` 决定升级规则且全局唯一；`sortOrder` 只决定展示顺序。

### 7.3 编辑页

字段：

- code、名称、副标题、详情；
- rank、sortOrder、状态；
- 价格、赠送消费金；
- 折扣和有效天数；
- 有序权益列表；
- 卡面模板、徽标和摘要。

校验：

- code 格式为大写字母、数字和下划线，创建后不可改；
- 金额精确转换为整数分；
- 折扣为 1.0–10.0 折；
- validDays 为 1–3650；
- 上架前至少一条权益；
- 赠送额度高于价格时显示醒目倍率提示但不强制禁止。

卡面只允许 `PEARL | CHAMPAGNE | JADE | OBSIDIAN` 受控主题，不接受任意 CSS 或任意颜色，保持轻奢风和文字对比度。

编辑携带 `version`；冲突时保留草稿并要求重新加载，不静默覆盖。

### 7.4 购卡记录

支持购卡单号、用户、等级、状态和时间筛选。详情展示购买快照、支付状态、会员链、额度 grant/流水和作废资格。

作废按钮先展示后端预检结果；最终条件仍由事务内权威校验。

## 8. H5 信息架构与交互

### 8.1 Profile 重组

拆分当前职责过重的 `ProfileSummary`：

```text
ProfileIdentityCard
MembershipCardCarousel
ProfileAccountInfo
ProfileServiceLinks
ProfileLogoutButton
```

页面顺序：

```text
个人中心标题
→ 身份摘要
→ 我的会员卡
→ 账号信息
→ 订单/地址/会员中心入口
→ 退出登录
→ Tabbar
```

基础资料和会员数据并行加载，错误独立展示；会员接口失败不阻断账号信息。

### 8.2 会员卡轮播

使用 Vant `Swipe` / `SwipeItem`，仅手动滑动，不自动播放。顺序：

1. 当前等级；
2. 可升级等级；
3. 已有更低等级，仅展示“当前等级更高”，不可购买。

卡片展示：

- 主题卡面、等级、徽标；
- 当前状态、到期时间；
- 折扣、可用消费金；
- 购卡价格与赠送额度；
- 一至两条权益摘要；
- 当前卡显示“续费”，高等级显示“升级”，低等级显示禁用状态。

轮播提供页码指示器、当前卡说明和辅助技术可读标签。点击卡片进入详情，不在轮播内直接完成购买。

无会员时仍展示全部可购等级；无上架等级时展示“会员服务准备中”。

### 8.3 路由与页面

```text
/membership-cards                 # 会员中心
/membership-cards/:id             # 卡详情与购买确认
/membership-purchases/:id         # 购卡结果/详情
```

会员中心展示当前会员、余额、全部等级、权益说明和最近消费金流水。卡详情展示完整权益、价格、赠送额度、折扣、有效期、升级/续费规则和购买按钮。

购买前必须登录并验证手机号。生产环境没有真实支付时显示“购买暂未开放”，不展示可触发模拟支付的假按钮。开发/测试环境显示明确标记的“模拟支付并开通”。

### 8.4 商品结算

结算页新增“会员优惠”区：

- 当前会员和折扣；
- 商品原价；
- 会员优惠；
- 当前消费金余额；
- 用户输入抵扣金额；
- 最大可抵扣提示；
- 最终应付金额。

元输入必须精确转换为分，不使用浮点。每次购物车、数量、履约或抵扣输入变化后进行防抖报价；提交前必须有未过期 quote token。

报价失效时保留表单，刷新金额并提示用户再次确认，不自动以新金额下单。

### 8.5 订单展示

H5 和 Admin 订单详情均展示：

- 商品原价；
- 会员等级与折扣；
- 会员优惠；
- 消费金抵扣；
- 最终应付。

无会员优惠时隐藏会员行，但金额字段仍有稳定默认值。

## 9. 幂等、并发、安全与审计

### 9.1 通用幂等

升级现有幂等记录，增加：

- operation；
- request hash；
- status；
- resource type/id；
- response snapshot 或可重建引用；
- expiresAt。

同一用户、operation、key 唯一。同 key 同请求返回原结果；同 key 不同请求返回 `IDEMPOTENCY_CONFLICT`；处理中返回 `IDEMPOTENCY_IN_PROGRESS`，不再复用库存不足错误码。

### 9.2 并发

- 会员配置使用 version 乐观锁；
- 购卡完成锁定购买单、账户和当前会员；
- 消费金扣减锁定账户并校验 version/余额；
- grant FIFO 扣减和账本写入同事务；
- 商品价格、会员版本和余额版本在下单线性化点重新校验；
- 所有乘法、求和和折扣计算检查 `Number.isSafeInteger` 与 `INT UNSIGNED` 上限。

### 9.3 权限与环境

- Public 只能读取上架等级；
- 用户只能读取自己的账户、购买单和流水；
- Admin API 只接受 `mall-admin`；
- 模拟支付需非生产环境且显式配置开启；
- 客户端提交的等级、折扣、余额、价格均不可信；
- 日志不得输出完整手机号、JWT 或支付敏感数据。

### 9.4 审计

以下操作与业务写入同事务：

- 创建/编辑/上下架/删除未售等级；
- 购卡作废；
- 未来如增加人工额度调整，也必须使用专用流水并审计。

审计日志记录“谁做了什么”；消费金账本记录“额度为什么变化”，两者不可互相替代。

## 10. 测试与验收

### 10.1 共享契约

- 可辨识联合非法状态使用 `@ts-expect-error` 拒绝；
- basis points、金额字段和状态枚举类型稳定；
- Admin、H5、API 不重复定义跨端 DTO。

### 10.2 API 单元测试

- 同级续费与过期后续费；
- 升级立即生效、禁止降购；
- 等级配置修改不影响已购快照；
- 行级折扣四舍五入和总额不变量；
- 消费金 min 规则；
- FIFO grant 分配；
- 订单取消精确冲正；
- 购卡作废资格；
- 金额上限和安全整数；
- 幂等同请求、冲突请求和处理中状态。

### 10.3 API 集成/E2E

- Admin 创建并上架等级 → Public 可见；
- 创建购卡单 → 模拟支付 → 发卡、grant、账户余额和流水原子提交；
- 并发模拟支付只发卡和入账一次；
- 并发订单不透支消费金；
- 报价过期或版本变化返回冲突；
- 下单保存完整会员和金额快照；
- 取消订单只返消费金、不回补库存；
- 作废未使用购卡恢复前一会员；
- 已使用折扣或额度后拒绝作废；
- user/admin audience 隔离；
- 生产环境拒绝模拟支付。

### 10.4 Admin 前端

- 路由和导航；
- 表单金额/折扣精确转换；
- rank 与 sortOrder 区分；
- version 冲突保留草稿；
- 卡面模板预览；
- 作废预检、确认和错误展示；
- 模块拆分与 feature API 边界。

### 10.5 H5 前端

- Profile 基础资料与会员并行加载且错误隔离；
- Swipe 默认定位当前卡、左右滑动和指示器；
- 当前卡续费、高等级升级、低等级禁购；
- 无会员、无上架等级、过期会员状态；
- 生产环境不显示模拟支付；
- 报价金额、抵扣输入、余额不足和报价失效；
- 创建订单只提交消费金意图和 quote token；
- 订单详情金额快照。

### 10.6 运行时验收

1. Admin 创建三个等级并预览卡面；
2. H5“我的”可左右滑动等级并定位当前会员；
3. 开发环境购买会员后立即展示等级、到期日和消费金；
4. 结算展示原价、折扣、输入抵扣和最终应付；
5. 下单后余额与流水正确，重复请求不重复扣款；
6. 取消订单返还消费金且库存不回补；
7. 权益未使用时 Admin 可作废购卡，使用后明确拒绝；
8. 375px 和 390px 下卡片、轮播、购买栏和结算表单无横向溢出，关键点击热区不小于 44px；
9. API、H5、Admin、contracts 的定向测试、typecheck、lint、format 和 build 通过。

## 11. 实施顺序

1. 共享契约和错误码；
2. 数据库迁移与实体；
3. 会员等级 Admin API 与审计；
4. 购卡、会员链、消费金账本与模拟支付；
5. 商品报价、订单价格快照和消费金扣减/返还；
6. Admin 会员卡配置和购卡记录；
7. H5 Profile 拆分、会员轮播、会员中心与购买；
8. H5 结算和订单金额展示；
9. 跨端 E2E、运行时截图和全量验证。
