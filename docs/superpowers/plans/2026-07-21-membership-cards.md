# Bake Mall 会员卡与消费金实施计划

> **执行要求：** 按任务顺序执行 TDD；当前工作区已有大量未提交改动，只允许增量编辑，禁止 reset/restore/clean/stash 或覆盖用户改动。

**目标：** 实现会员等级运营、购卡与开发环境模拟支付、单卡会员链、永久消费金账本、商品订单会员折扣与抵扣，以及 Admin/H5 完整闭环。

**架构：** `@bake-mall/contracts` 是跨端唯一契约；`MembershipModule` 拥有等级、购卡、会员链、额度与定价，`OrdersModule` 在原订单事务内消费会员服务。所有资金型变化使用账户汇总、来源 grant、不可变流水和 allocation；订单保存不可变价格与会员快照。

**技术栈：** Node.js 22、pnpm 9、TypeScript、NestJS 11、TypeORM、MySQL 8、Vue 3、Vite、Vant 4、Element Plus、Vitest。

## 全局约束

- 权威规格：`docs/superpowers/specs/2026-07-21-membership-cards-design.md`。
- 每项行为先写失败测试并确认 RED，再写最小实现和确认 GREEN。
- API 相对导入使用 `.js` 后缀。
- 金额统一整数分，折扣统一整数基点；检查安全整数与 `INT UNSIGNED` 上限。
- 新表使用 `BIGINT UNSIGNED`、UTC `DATETIME`、`utf8mb4_unicode_ci`，仅由迁移管理。
- Admin/H5 遵循 `frontend-page-generator` 和 `js-functional-style`，完整保留 `components/hooks/mock/config/type/api` 边界。
- 生产环境必须拒绝模拟支付，且前端不得展示模拟支付按钮。
- 不提交、不推送、不创建 PR，除非用户另行要求。

---

### Task 1：共享会员、报价与订单金额契约

**文件：**

- 创建：`packages/shared-contracts/src/membership.ts`
- 创建：`packages/shared-contracts/src/membership.spec.ts`
- 修改：`packages/shared-contracts/src/order.ts`
- 修改：`packages/shared-contracts/src/enums.ts`
- 修改：`packages/shared-contracts/src/index.ts`

**产物：** 会员等级/主题/状态、购卡、消费金、会员概览、报价 DTO；订单请求增加 `requestedCreditCents` 与 `quoteToken`；订单和订单项增加原价、折扣、消费金、应付与会员快照；新增会员、报价和幂等错误码。

- [ ] 写合法 fixture 和 `@ts-expect-error` 非法联合测试。
- [ ] 运行 `pnpm --filter @bake-mall/contracts test && pnpm --filter @bake-mall/contracts typecheck`，确认因缺少契约失败。
- [ ] 实现最小契约与导出。
- [ ] 运行 contracts 的 test/typecheck/build/lint，确认通过。

### Task 2：`0005` 迁移与 TypeORM 实体

**文件：**

- 创建：`apps/api/src/database/migrations/0005-membership-and-order-pricing.ts`
- 创建：对应迁移测试
- 创建：membership level、account、purchase、user membership、grant、entry、allocation 七个实体
- 修改：订单、订单项、幂等实体、实体索引、data source、database module、环境 schema/example

**产物：** 七张会员表；订单价格快照列；通用幂等列和 `(user_id, operation, key)` 唯一键；模拟支付与报价 token 配置。

- [ ] 写迁移 SQL 与实体元数据失败测试。
- [ ] 运行 API 定向测试确认 RED。
- [ ] 实现迁移、实体、索引、CHECK 与环境校验。
- [ ] 运行定向测试、typecheck、lint 和两次 migration:run；第二次必须无待执行迁移。

### Task 3：会员等级 Admin/Public API 与事务审计

**文件：**

- 创建：`apps/api/src/membership/` 模块、service、admin/public controllers、DTO 和测试
- 修改：`apps/api/src/app.module.ts`
- 创建：`apps/api/test/membership-levels.e2e-spec.ts`

**产物：** `/public/membership-levels*` 和 `/admin/membership-levels*`；code/rank/金额/折扣/有效期校验；version 乐观锁；已售等级不可删除；变更与审计同事务。

- [ ] 写 service 与 E2E 失败测试。
- [ ] 运行确认 404/缺少实现的 RED。
- [ ] 实现最小 CRUD、映射、校验和审计。
- [ ] 运行单元、E2E、auth isolation、typecheck、lint。

### Task 4：购卡、会员链、消费金账本与模拟支付

**2026-07-22 已确认调整：** 同级有效期内续费直接延长当前会员，不创建新的 `user_memberships`；每笔成功购卡通过不可变 entitlement segment 记录时间贡献。有效期内升级按目标等级全价支付并立即生效，低等级剩余及未来已续天数不折算、不退款、不顺延。

**文件：**

- 创建：`0006-membership-entitlement-segments` 迁移、实体和迁移/元数据测试；不得继续修改已经 Task 2 gate 通过的 `0005`
- 创建：membership credit service、有效期贡献事务辅助、customer controller、购卡 DTO、购买与账本测试
- 扩展：admin membership controller/service/module、共享 Admin 购卡详情契约
- 创建/扩展：`apps/api/test/membership-purchases.e2e-spec.ts` 及隔离真实 MySQL 的续费、支付并发、作废并发测试

**产物：** `/me/membership`、购卡记录、额度流水、创建购卡、模拟支付；Admin 购卡列表/完整详情/作废；同级续费延长当前卡、过期重开、升级立即生效、禁止降购；entitlement segment + grant + account + immutable entries；作废精确回退有效期或恢复前一会员。

- [ ] 写有效期内续费无空窗、续费链尾 segment、过期续费、升级全价立即生效、低等级未来天数失效和禁止降购失败测试。
- [ ] 写同一 purchase 并发支付只履约一次、创建/支付幂等、生产拒绝模拟支付、金额上限失败测试。
- [ ] 写作废与额度消费并发、锁内资格重判、原流水关联、续费回退、升级恢复/过期不恢复和事务回滚失败测试。
- [ ] 写 Admin 完整详情的会员链、segment、grant、流水与作废资格失败测试。
- [ ] 运行确认 RED。
- [ ] 实现 `0006`、事务内会员时间状态机、独立 `MembershipCreditService`、入账和作废。
- [ ] 运行定向单元/E2E、真实 MySQL 并发、contracts test/typecheck/build/lint、API typecheck/lint/build。

#### Task 4.1：共享 entitlement 与 Admin 购卡详情契约

**文件：**

- 修改：`packages/shared-contracts/src/membership.ts`
- 修改：`packages/shared-contracts/src/membership.spec.ts`
- 修改：`packages/shared-contracts/src/membership-contracts.type-test.ts`
- 修改：`packages/shared-contracts/src/index.ts`

**接口：**

- 新增 `MembershipEntitlementSegmentKind = INITIAL | RENEWAL | UPGRADE`。
- 新增 `MembershipEntitlementSegmentView`、`AdminMembershipRecordView`、`AdminMemberCreditGrantView`、`AdminMemberCreditEntryView`、`AdminMembershipPurchaseDetailView`。
- `AdminMembershipPurchaseDetailView` 必须包含完整 purchase 快照、用户会员链、当前 purchase 的 segment、grant、关联流水和结构化 `voidability`。
- 续费 purchase 的 `membershipId` 来自 segment；`user_memberships.purchase_order_id` 仍只表示首次创建该会员记录的 purchase。

- [ ] 先写 runtime fixture 和 `@ts-expect-error`：非法 segment kind、缺失 Admin 详情字段、续费 segment 无法指向原 membership 时必须失败。
- [ ] 运行 `pnpm --filter @bake-mall/contracts test && pnpm --filter @bake-mall/contracts typecheck`，确认 RED 来自缺少契约。
- [ ] 实现最小共享类型；时间使用 ISO 字符串，不暴露 ORM Entity 或 `Date`。
- [ ] 运行 contracts test/typecheck/build/lint，确认 GREEN。

#### Task 4.2：`0006` entitlement segment 迁移与实体

**文件：**

- 创建：`apps/api/src/database/migrations/0006-membership-entitlement-segments.ts`
- 创建：`apps/api/src/database/migrations/0006-membership-entitlement-segments.spec.ts`
- 创建：`apps/api/src/database/entities/membership-entitlement-segment.entity.ts`
- 修改：`apps/api/src/database/entities/index.ts`
- 修改：`apps/api/src/database/entities/membership-entities.spec.ts`
- 修改：`apps/api/src/database/data-source.ts`
- 修改：`apps/api/src/database/database.module.ts`
- 修改：`apps/api/src/membership/membership.module.ts`

**最终 schema：**

```sql
CREATE TABLE membership_entitlement_segments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  membership_id BIGINT UNSIGNED NOT NULL,
  purchase_order_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('INITIAL','RENEWAL','UPGRADE') NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  previous_membership_id BIGINT UNSIGNED NULL,
  previous_membership_ends_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE INDEX uniq_membership_entitlement_segments_purchase (purchase_order_id),
  INDEX idx_membership_entitlement_segments_membership_period (membership_id, ends_at, id),
  CONSTRAINT chk_membership_entitlement_segments_period CHECK (ends_at > starts_at),
  CONSTRAINT chk_membership_entitlement_segments_upgrade_restore CHECK (
    (kind = 'UPGRADE' AND previous_membership_id IS NOT NULL AND previous_membership_ends_at IS NOT NULL)
    OR
    (kind IN ('INITIAL','RENEWAL') AND previous_membership_id IS NULL AND previous_membership_ends_at IS NULL)
  ),
  CONSTRAINT fk_membership_entitlement_segments_membership FOREIGN KEY (membership_id) REFERENCES user_memberships(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_membership_entitlement_segments_purchase FOREIGN KEY (purchase_order_id) REFERENCES membership_purchase_orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_membership_entitlement_segments_previous FOREIGN KEY (previous_membership_id) REFERENCES user_memberships(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] 先写 migration SQL、entity metadata、CHECK 与 FK 失败测试；确认缺少 `0006` 的 RED。
- `previous_membership_id` restore FK 固定 `ON UPDATE RESTRICT`；MySQL 8.4 errno 3823 不允许该列同时参与 upgrade restore CHECK 与 `ON UPDATE CASCADE`，且会员主键不可变，因此不尝试 CASCADE fallback。
- [ ] 实现 `MembershipEntitlementSegments1718000000005`，只新增 segment 表，不再修改 `0005`，也不新增 `user_memberships.valid_days`。
- [ ] 为迁移前已存在且曾成功履约的 purchase（`FULFILLED/SUCCEEDED` 或 `VOIDED/REVERSED`，`paid_at` 非空）按其对应 `user_memberships` 实际区间回填一条 segment；旧数据保持原模型，不折叠或改写历史 membership。
- [ ] 历史数据仅在 previous 同用户、支付时仍有效、目标 rank 严格提高且新 membership 从 `paidAt` 开始时标为 `UPGRADE`，并保存 previous 原始 `endsAt`；其他历史独立 membership（包括旧模型同级续费、过期重开）都标为 `INITIAL`。历史回填不得产生 `RENEWAL`。
- [ ] 迁移前后验证每条曾履约 purchase 恰有一个 segment、PENDING 无 segment、user membership 行未被改写；任何缺失 membership、支付状态/时间矛盾或区间异常都中止迁移。
- [ ] 验证新模型 renewal segment 可让 `purchase_order_id` 指向新 purchase、`membership_id` 指向原 membership，不触发 `uniq_user_memberships_purchase`。
- [ ] `down` 只能在不存在新模型 `RENEWAL`，且不存在“previous 已被截短但 segment 保存了更晚原始 endsAt”的新版 `UPGRADE` 时删除表；否则明确拒绝无损回滚并要求 forward fix/备份恢复。
- [ ] 使用全新临时库运行 0001–0006、第二次无 pending、在无新模型写入时 revert 0006；确认 0001–0005 数据不变、schema 与临时授权清零。

#### Task 4.3：独立 `MembershipCreditService`

**文件：**

- 创建：`apps/api/src/membership/membership-credit.service.ts`
- 创建：`apps/api/src/membership/membership-credit.service.spec.ts`
- 修改：`apps/api/src/membership/membership.module.ts`
- 修改：`apps/api/src/membership/membership-purchase.service.ts`

**接口：**

```ts
lockOrCreateAccount(manager, userId): Promise<MemberAccount>
grantMembershipPurchase(manager, account, purchase): Promise<CreditMutationResult>
reverseUnusedMembershipPurchaseGrant(manager, account, purchase): Promise<CreditMutationResult>
debitFifo(manager, account, input): Promise<CreditMutationResult>
reverseDebit(manager, account, input): Promise<CreditMutationResult>
```

- [ ] 先写发放零/正额度、重复发放、UINT 上限、FIFO、余额不足、精确冲正与重复冲正测试并确认 RED。
- [ ] 实现固定锁序“已锁 user → account → grants(createdAt,id) → entries → allocations”。
- [ ] 发放流水 `operationKey=membership-purchase-grant:<purchaseId>`；作废流水 `operationKey=membership-purchase-void:<purchaseId>`，且 `reversalOfEntryId` 指向原发放流水。
- [ ] Task 6 必须复用 `debitFifo`/`reverseDebit`，不得在 OrdersService 重写余额、grant、entry 或 allocation 算法。
- [ ] 运行 credit 与 purchase service 定向测试、API typecheck/lint。

#### Task 4.4：会员时间状态机与支付幂等

**文件：**

- 创建：`apps/api/src/membership/membership-entitlement.service.ts`
- 创建：`apps/api/src/membership/membership-entitlement.service.spec.ts`
- 修改：`apps/api/src/membership/membership-purchase.service.ts`
- 修改：`apps/api/src/membership/membership-purchase.service.spec.ts`
- 修改：`apps/api/src/membership/membership.module.ts`

**接口：**

```ts
applyPaidPurchase(manager, { account, purchase, now }): Promise<MembershipApplicationResult>
restoreVoidedPurchase(manager, { account, purchase, segment, now }): Promise<MembershipRestoreResult>
```

- [ ] RED：首次开卡创建 membership + `INITIAL` segment；有效同级续费只延长原 membership 并创建 `RENEWAL` segment；过期购买创建新 membership；升级立即创建新 membership + `UPGRADE` segment；降购拒绝。
- [ ] 同级续费的 `segment.startsAt` 等于支付前 `membership.endsAt`，`segment.endsAt` 使用**本次 purchase 快照的 `validDays`**计算；当前会员的 code/name/rank/discount/benefits/theme/badge 快照不变。
- [ ] 升级保存 `previousMembershipId` 和被截断前的 `previousMembershipEndsAt`；旧等级所有未来时间不迁移到新等级。
- [ ] 支付固定锁序：user → account → purchase → idempotency → current membership → chain-tail segment → credit。
- [ ] 同一 purchase 同 key/不同 key/并发重试都只产生一条 segment、一次 grant 和一条发放流水；同 key 不同 purchase 返回 `IDEMPOTENCY_CONFLICT`。
- [ ] production 即使开关为 true 也返回 `SIMULATED_PAYMENT_DISABLED`；任何中途失败都回滚 purchase、会员、segment 和额度。
- [ ] 运行 entitlement/purchase/credit service 定向测试。

#### Task 4.4 完成记录（2026-07-23）

- [x] 新增 `MembershipEntitlementService` 及单测；首次、过期重开、同级续费、升级、降购、链尾不连续均经 RED/GREEN 覆盖。
- [x] `simulatePayment` 改为委托权益服务与 `MembershipCreditService`，移除支付路径中本地 grant/entry/account 写入；同级续费不新建会员，成功重试依赖 segment 查回 membership。
- [x] 最小适配 HTTP mock 与当前 MySQL 并发测试；定向单测与 E2E、API typecheck/lint/build、Prettier、`git diff --check` 已执行。
- [ ] Task 4.5 作废恢复、Admin 详情与 Task 6 订单调用仍不属于本子任务。

#### Task 4.5：锁内作废资格与精确恢复

**文件：**

- 修改：`apps/api/src/membership/membership-entitlement.service.ts`
- 修改：`apps/api/src/membership/membership-entitlement.service.spec.ts`
- 修改：`apps/api/src/membership/membership-purchase.service.ts`
- 修改：`apps/api/src/membership/membership-purchase.service.spec.ts`

- [x] RED：grant 已使用、segment 非链尾、会员折扣已使用、重复作废、作废审计失败、作废与额度消费并发。
- [x] 作废事务只能把无锁读取的 purchase 用作 userId 提示；锁定 user/account/purchase/membership/segment/grant/original entry 后必须重新判定全部资格。
- [x] `RENEWAL` 作废回退同一 membership 的 `endsAt`；回退后已过期则置 `EXPIRED` 并清空账户指针。
- [x] `UPGRADE` 作废将新会员置 `VOIDED`，恢复旧会员原始 `endsAt`；旧会员仍在有效期则恢复 `ACTIVE`，否则置 `EXPIRED` 并清空指针。
- [x] `INITIAL` 作废将会员置 `VOIDED`，只恢复作废时仍有效的前一会员。
- [x] segment 永不删除/更新；purchase 用 `VOIDED/REVERSED` 表示作废，所有业务变化与 audit 同事务。
- [ ] 运行真实 MySQL 作废/扣款竞态；任何串行结果都必须满足 `account.availableCreditCents = SUM(non-reversed grant.remainingCents)`。

#### Task 4.6：Customer/Admin API 与完整详情

**文件：**

- 修改：`apps/api/src/membership/customer-membership.controller.ts`
- 修改：`apps/api/src/membership/admin-membership-purchases.controller.ts`
- 修改：`apps/api/src/membership/membership-purchase.service.ts`
- 修改：`apps/api/test/membership-purchases.e2e-spec.ts`

- [x] RED：customer/admin audience；缺少 Idempotency-Key；production 模拟支付；续费 purchase 的 membershipId；Admin 详情缺链/segment/grant/entries/voidability。
- [x] Admin 列表保持分页轻量；详情返回 `AdminMembershipPurchaseDetailView`，作废端点返回更新后的完整详情。
- [x] 详情流水包含原发放与作废冲正；预检仅供展示，最终授权必须来自 Task 4.5 的锁内判断。
- [x] 统一 purchase not-found/state/credit-limit/idempotency 错误为共享 `ApiErrorCode` 和中文 message；新增跨端错误码时同步 contracts runtime/type tests。
- [x] 运行 HTTP E2E、auth isolation、contracts 与 API 静态检查。

#### Task 4.7：真实 MySQL 并发与最终验证

**文件：**

- 修改：`apps/api/test/membership-payment-concurrency.e2e-spec.ts`
- 创建：`apps/api/test/membership-void-concurrency.e2e-spec.ts`
- 复用：`apps/api/test/helpers/mysql-test-database.ts`

- [x] 同一 purchase 并发支付：严格一条 membership/segment/grant/entry。
- [x] 两个同级续费并发：仍只有一条 membership，segment 连续无重叠，最终 endsAt 正确。
- [x] 升级与低等级续费并发：只能得到合法串行结果，不能出现两个 ACTIVE、未来指针或低等级覆盖高等级。
- [x] 作废与 `debitFifo` 并发、重复作废并发、audit 失败回滚；不得出现死锁超时、负余额、重复流水或守恒破坏。
- [x] 所有 MySQL 测试使用随机临时 schema；结束时 schema/grant 都为 0，禁止连接或清空 `bake_mall`。
- [x] 运行 contracts test/typecheck/build/lint；Task 4 全部 API unit/HTTP/MySQL tests；API typecheck/lint/build；Prettier；`git diff --check`。

### Task 5：会员定价与短期报价 token

**文件：**

- 创建：membership pricing service、quote token service、quote DTO 与测试
- 创建：`apps/api/test/orders-quote.e2e-spec.ts`

**产物：** `POST /orders/quote`；行级整数折扣；消费金 min 规则；token 绑定用户、购物车、SKU/会员/账户版本和 TTL；报价无副作用。

- [x] 写 1 分边界、四舍五入、无会员、余额截断、token 过期/篡改测试。
- [x] 运行确认 RED。
- [x] 实现纯定价和签名 token。
- [x] 运行单元/E2E、typecheck、lint。

### Task 6：商品订单幂等、会员快照、额度扣减与取消冲正

**文件：**

- 创建：`apps/api/src/idempotency/` 通用服务与测试
- 修改：orders module/service/controller/DTO/tests 与 membership pricing/credit services
- 修改：`apps/api/test/orders.e2e-spec.ts`

**产物：** 同 key 同请求返回原结果；不同请求冲突；处理中独立错误；下单事务内重定价、扣库存、FIFO 扣 grant、写 allocation/流水和订单快照；取消只返消费金、不回补库存。

- [ ] 扩展现有测试，保留当前分页、LIKE、日期和快照测试。
- [ ] 运行确认幂等、报价 stale、额度与取消行为 RED。
- [ ] 实现通用幂等、事务定价/扣款/冲正。
- [ ] 运行订单、会员、幂等单元/E2E、typecheck、lint。

### Task 7：Admin 会员卡配置

**文件：**

- 创建：`apps/admin-web/src/views/membership-cards/` 全模块和测试
- 修改：Admin router、navigation、layout tests、金额工具

**产物：** 列表、编辑、上下架、删除未售草稿、四主题预览；精确金额/折扣转换；version 冲突保留草稿。

- [ ] 写路由、API boundary、hook、表单和预览失败测试。
- [ ] 运行确认 RED。
- [ ] 实现 feature 模块和导航。
- [ ] 运行 Admin 定向测试、typecheck、lint、build。

### Task 8：Admin 购卡记录与作废

**文件：**

- 创建：`apps/admin-web/src/views/membership-purchases/` 全模块和测试
- 修改：router 与 navigation

**产物：** 购卡筛选、详情、会员链、grant/流水、作废资格和二次确认；乱序请求隔离。

- [ ] 写路由、筛选、详情、作废和错误状态失败测试。
- [ ] 运行确认 RED。
- [ ] 实现列表/抽屉/hook/API。
- [ ] 运行 Admin 定向测试、typecheck、lint、build。

### Task 9：H5 Profile、会员轮播与购买页面

**文件：**

- 拆分：Profile identity/account/links/logout 组件
- 创建：Profile 会员 hook 与 carousel
- 创建：`apps/h5-store/src/views/membership/` 全模块和测试
- 修改：H5 router、ProfileView、feature exports/tests

**产物：** Profile 身份后展示会员资产；Vant Swipe 手动轮播；当前卡续费、高级升级、低级禁购；会员中心、详情、购买结果；生产隐藏模拟支付。

- [ ] 写 Profile 错误隔离、轮播、路由、购买能力和幂等测试。
- [ ] 运行确认 RED。
- [ ] 实现模块拆分与页面。
- [ ] 运行 H5 定向测试、typecheck、lint、build。

### Task 10：H5 结算报价与跨端订单金额展示

**文件：**

- 创建：Checkout membership pricing component 与 `useOrderQuote`
- 修改：CheckoutView/useCheckout/api/type/config/tests、H5 orders、Admin order detail 与 mocks/tests

**产物：** 元字符串精确转分；防抖且仅最新报价生效；stale 保留表单并重新确认；创建订单只提交抵扣意图和 token；H5/Admin 展示同一金额快照。

- [ ] 写抵扣输入、防抖、乱序、token 过期、stale 和展示失败测试。
- [ ] 运行确认 RED。
- [ ] 实现报价状态机和金额展示。
- [ ] 运行 H5/Admin 定向测试、typecheck、lint、build。

### Task 11：跨端 E2E 与运行时验收

**文件：**

- 创建：`apps/api/test/membership-order.e2e-spec.ts`
- 扩展：auth isolation、orders、membership E2E 与前端路由/模块测试

**验收：** Admin 创建三等级；H5 Profile 可滑动；模拟购卡后发卡/额度正确；结算折扣与抵扣；并发不透支；取消返额度不回库存；未使用可作废、已使用拒绝；生产拒绝模拟支付；375/390px 无溢出且触控区 ≥44px。

- [ ] 写全链路失败 E2E。
- [ ] 运行确认遗漏行为 RED。
- [ ] 修复所有剩余集成缺口。
- [ ] 运行 contracts/API/H5/Admin 全量 test、typecheck、lint、build、format。
- [ ] 启动实际应用，执行 API smoke、Admin/H5 浏览器流程和截图验收。
