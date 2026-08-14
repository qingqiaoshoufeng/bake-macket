# 单一小程序与芯烨云打印实施路线图

> **面向执行代理：** 必须按顺序执行以下五份计划。每份计划均要求使用 `superpowers:subagent-driven-development`（推荐），也可使用 `superpowers:executing-plans`，不得越过阶段门。

**目标：** 将已批准的用户管理、普通管理员、单一小程序管理区和芯烨云打印规格拆成五个可独立验收、可停止回滚的实施计划。

**权威规格：** `docs/superpowers/specs/2026-08-03-miniapp-cloud-printing-user-admin-design.md`

## 执行顺序

1. [`2026-08-04-miniapp-cloud-printing-1-identity.md`](./2026-08-04-miniapp-cloud-printing-1-identity.md)
   - 统一迁移注册；
   - User tombstone/token version、`UserIdentityService`；
   - audit actor 与微信 credential use 迁移；
   - placeholder 合并；
   - OPERATOR 身份、固定 1024 HMAC bucket 的统一联合登录、每管理员精确改密/二次验证窗口和即时撤权。
2. [`2026-08-04-miniapp-cloud-printing-2-permissions-users.md`](./2026-08-04-miniapp-cloud-printing-2-permissions-users.md)
   - 既有 Admin endpoint 默认 SUPER_ADMIN；
   - OPERATOR 八项 permission 白名单；
   - 用户管理 API 与 H5 微信真实登录接线；
   - Admin Web 与小程序用户管理、普通改密基础。
3. [`2026-08-04-miniapp-cloud-printing-3-devices.md`](./2026-08-04-miniapp-cloud-printing-3-devices.md)
   - 芯烨云配置与 adapter；
   - 0012 云打印机 schema 与通用 `admin_operation_idempotency`；
   - BINDING / 验证码 / 补偿 / recovery，不在本阶段开放解绑；
   - 双端设备管理、rename 与禁用解绑说明。
4. [`2026-08-04-miniapp-cloud-printing-4-print-jobs.md`](./2026-08-04-miniapp-cloud-printing-4-print-jobs.md)
   - 服务端不可变小票；
   - 原子一项 batch 的单张打印；
   - 纯客户端拉动批次；
   - UNKNOWN / MANUAL_REVIEW；
   - 真实 repository 解绑门禁与解绑 API/UI 启用；
   - 180 天 PII 清理。
5. [`2026-08-04-miniapp-cloud-printing-5-ui-acceptance-retirement.md`](./2026-08-04-miniapp-cloud-printing-5-ui-acceptance-retirement.md)
   - Admin Web 和小程序打印运营闭环；
   - 花生壳体验版与真实芯烨云验收；
   - 真实验收通过后退役 Android/TCP 旧路径。

## 全局门禁

- 每个行为改动执行 RED → GREEN TDD；
- 新 NestJS 相对导入使用 `.js` 后缀；
- 跨应用 DTO 只定义在 `@bake-mall/contracts`；
- 迁移文件编号固定：0010 homepage multiple drafts，0011 identity + audit + wechat credential uses，0012 cloud printers + admin operation idempotency，0013 print jobs；兼容已执行双历史，identity / cloud migration class name 仍分别保留 `UserAdminIdentity1718000000009` / `CloudPrinters1718000000010`；
- 第 13.5 节所有写操作统一复用 0012 幂等 service，同 key 同 hash replay、不同 hash conflict、并发单 owner、UNKNOWN 可 reconcile；
- 状态只使用完整枚举名 `PENDING_VERIFICATION`、`COMPLETED_WITH_ISSUES`、`MANUALLY_CLOSED` 等，禁止别名；
- 金额使用整数分；
- Admin Web、H5 与小程序管理模块按 `components/hooks/mock/config/type/api` 六职责拆分；
- 执行每个 Admin Web/H5 task 前必须通过 Skill 调用；CLI 不支持 Skill 时读取项目 skill 加载 `frontend-page-generator` 与 `js-functional-style`；
- 原生小程序 feature API 只能调用 `utils/api-client`，admin 目录静态测试禁止直接 `wx.request`；原生组件使用四件套目录并通过页面 `usingComponents` 注册；
- TypeScript/JavaScript 使用不可变、ES6-first 写法；
- 真实 MySQL 测试使用随机 schema，执行统一迁移列表并清理 schema/user/grant；
- 开发中运行定向测试，计划阶段门运行相关 package 的 test/typecheck/lint/build；
- 不提交真实 `XPYUN_USER_KEY`、SN/PID、手机号、地址、花生壳私有配置与小程序 AppSecret；
- 第五份计划真实验收通过前不得删除 `apps/merchant-terminal/`以及旧打印设计/计划。
