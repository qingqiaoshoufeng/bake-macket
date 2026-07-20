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

**文件：**

- 创建：membership credit service、customer controller、购卡 DTO、购买与账本测试
- 扩展：admin membership controller/service/module
- 创建：`apps/api/test/membership-purchases.e2e-spec.ts`

**产物：** `/me/membership`、购卡记录、额度流水、创建购卡、模拟支付；Admin 购卡列表/详情/作废；同级续费、升级、禁止降购；grant + account + immutable entries；作废恢复前一会员。

- [ ] 写续费、升级、降购、并发支付、grant、作废与生产禁用失败测试。
- [ ] 运行确认 RED。
- [ ] 实现事务内发卡、入账、会员链和作废。
- [ ] 运行定向单元/E2E、typecheck、lint。

### Task 5：会员定价与短期报价 token

**文件：**

- 创建：membership pricing service、quote token service、quote DTO 与测试
- 创建：`apps/api/test/orders-quote.e2e-spec.ts`

**产物：** `POST /orders/quote`；行级整数折扣；消费金 min 规则；token 绑定用户、购物车、SKU/会员/账户版本和 TTL；报价无副作用。

- [ ] 写 1 分边界、四舍五入、无会员、余额截断、token 过期/篡改测试。
- [ ] 运行确认 RED。
- [ ] 实现纯定价和签名 token。
- [ ] 运行单元/E2E、typecheck、lint。

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
