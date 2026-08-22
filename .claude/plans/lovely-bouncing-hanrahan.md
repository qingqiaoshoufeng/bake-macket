# 微信头像昵称资料完善实施计划

## Context

当前微信登录仅通过 `wx.login + jscode2session` 获取 OpenID 与可选 UnionID，`users.nickname` / `avatar_url` 虽已存在，但没有用户主动选择头像、确认昵称和保存资料的生产链路。用户要求实现微信小程序授权式资料完善，并已确认：

- 首次登录资料不完整时进入原生完善页，但**允许跳过**；同一登录会话不重复弹，下次新登录仍可提示；
- 头像最大 **5 MiB**；
- 完成后仍可从 H5“我的”页面再次修改；
- 使用唯一 `bake-mall-main` MySQL/MinIO，不创建第二套环境。

实现必须保持 H5 与原生小程序 customer JWT 隔离；`chooseAvatar` 返回的临时路径不得持久化；头像必须上传到当前用户拥有的对象存储命名空间，服务端不能接受任意外部 `avatarUrl`。

## 1. 共享契约、迁移与资料不变量

修改共享契约：

- `packages/shared-contracts/src/customer.ts` / `auth.ts` / `media.ts`
- 新增顾客头像预签名请求/响应、`UpdateCustomerProfileRequest`。
- `CustomerProfileView` / `UserProfileView` 增加 `profileCompleted`，由“规范化昵称非空 + 受管理头像存在”计算。
- 更新类型级测试，禁止空 patch、客户端提交任意 `avatarUrl`、scope 或 userId。

新增 migration 与实体字段：

- `apps/api/src/database/migrations/0017-user-avatar-object-key.ts`
- `users.avatar_object_key VARCHAR(512) NULL`
- 更新 migration registry、entity metadata 与 up/down 测试。
- 历史 `avatar_url` 不反推 object key，也不视为完成的受管理头像。

资料规则：

- 昵称 trim 后 1–64 字符，拒绝控制字符；允许常规中文、英文、数字、空格和 emoji，不做 HTML 清洗（Vue/WXML 文本插值负责转义）。
- 头像只允许 JPEG/PNG/WebP，最大 5 MiB。
- 顾客只能采用 `users/<userId>/avatars/<server-uuid>.<ext>` 下的对象。
- `avatarObjectKey + avatarUrl` 成对保存；URL由服务端根据对象 key 和配置生成。

同步补齐手机号身份合并策略：canonical 非空昵称/受管理头像优先，否则用 source 补齐；头像 key/url 作为不可拆分二元组迁移；source tombstone 清空展示资料。用单元测试和真实 MySQL e2e 锁定。

## 2. API 顾客资料与头像上传

新增 `CustomerProfileService`，由 `MeController` 暴露：

- `POST /api/v1/me/profile/avatar/presign`
- `PATCH /api/v1/me/profile`

两者继承 `JwtUserGuard`，只接受 `mall-user`。

预签名：

- 不接收 scope 或 userId；服务端根据当前用户生成 key。
- 将现有 admin upload 中 AWS S3/MinIO presigned POST 细节抽为内部可复用服务，但保持 admin/customer controller 权限分离。
- policy 固定 key、Content-Type、`content-length-range 1..5 MiB`、短期失效。

采用头像前：

- 校验严格用户前缀及无歧义 key；
- `HeadObject` 确认对象存在、Content-Type 和大小；
- 检查 JPEG/PNG/WebP 魔数与声明类型一致；
- 服务端推导公开 URL，客户端只提交 object key。

资料更新：

- 对当前 User 加行锁并重新确认 active、未合并；
- 只更新请求中出现的 nickname/avatar；不修改 OpenID/UnionID、手机号、订单联系号、tokenVersion；
- 返回完整最新 `CustomerProfileView`。
- 抽取统一 profile mapper，供 `GET /me`、微信登录 session 和更新响应复用，确保 `profileCompleted` 与 null/optional 语义一致。

TDD seam：shared contract、DTO、CustomerProfileService、presign policy、customer e2e、audience isolation、身份合并 MySQL e2e。

## 3. 原生小程序资料完善页

新增模块与页面：

- `apps/miniapp-shell/pages/profile-completion/`
- 对应 `components/`、`hooks/`、`api/`、`type/`、`config/`、`mock/` 模块；页面只做宿主接线。
- `app.json` 注册页面；build-check/wiring tests 锁定官方控件。

WXML 使用：

- `button open-type="chooseAvatar" bindchooseavatar="onChooseAvatar"`
- `input type="nickname" maxlength="64"`
- 头像预览、保存、重试与“稍后设置”。

原生会话：

- 页面进入时重新调用 `wx.login` 并用 `/auth/wechat/login` 取得仅在 App 内存保存的 customer session；不从 H5 接收 JWT，也不把原生 JWT交回 H5。
- 资料完整时预填已有昵称/头像；后续从“我的”进入时复用同一页面。

上传：

- 扩展唯一 `utils/api-client.ts`，提供受控 `uploadPresignedPost()`，内部调用 `wx.uploadFile`。
- source-boundary 精确允许 canonical client 使用 `wx.request` / `wx.uploadFile`，其他页面、hook、feature API 仍禁止直接网络调用。
- 对象存储上传不带 API Authorization，不记录临时路径、上传 URL 签名或 fields。
- 选择头像时仅保留临时预览；点击保存后依次执行 file info → presign → upload → PATCH profile。
- 上传成功而 PATCH 失败时在页面内存复用 object key 重试，不重复上传。

允许跳过：

- 显式“稍后设置”和系统返回都生成一次 `skipped` outcome，不发上传/更新请求，不撤销已成功的 H5 登录；本次登录不再弹，下次新登录仍可提示。

## 4. 原生/H5 一次性 handoff 与资料刷新

在现有 bridge 模式上新增 `PROFILE_UPDATED` / `PROFILE_SKIPPED`：

- 原生 App 仅在内存保存受信任 returnUrl 与 outcome；不携带 JWT、userId、昵称、头像 URL、object key。
- index `onShow` 重建 web-view；匹配 deliveryId 的 `bindload` 后才消费，失败保留重试，stale load 不得消费新 handoff。
- H5 bridge 严格解析并擦除参数，拒绝与登录 code/手机号 credential 混合或重复。

微信登录 coordinator：

- `applyCustomerSession` 后检查 `profileCompleted`；资料不完整且本次登录未提示过时打开原生页。
- JSSDK 不可用或用户跳过时保留有效登录，不白屏、不清 session。
- H5“我的”页面增加“修改头像昵称”入口，主动打开同一原生页。

收到 `PROFILE_UPDATED`：

- H5 使用**自己的** bearer token 调用 `GET /me`；
- 经统一 mapper 后 `auth.setProfile()` 更新 Pinia/localStorage；
- mounted ProfileView 同步刷新或直接观察 store；
- 失败时显示可重试状态，不形成自动循环。

H5 展示：`ProfileIdentityCard` 渲染真实头像并保留首字 fallback；更新“首期不支持修改”的旧文案。

## 5. Admin 可观察刷新

沿用当前工作区用户列表和详情实现：

- 顾客更新后，Admin API 已自然返回最新 nickname/avatarUrl；不暴露 avatarObjectKey。
- 用户列表增加显式“刷新”；详情抽屉复用 `retry()` 增加刷新按钮。
- 不引入轮询、SSE 或 WebSocket。
- 头像错误继续回退昵称首字。

## 6. 文档、域名与安全

更新：

- `docs/runbook/wechat-miniapp-setup.md`
- `docs/runbook/deployment.md`
- 相关设计规格

明确微信后台必须登记：

- request 合法域名（API）；
- uploadFile 合法域名（稳定的对象存储上传 host）；
- downloadFile 合法域名（头像 CDN/对象存储）；
- web-view 业务域名（H5）；
- 生产 HTTPS 且不得关闭 `urlCheck`。

不得把 JWT、微信 code、临时头像路径、presign fields 或完整上传 URL写入 storage、URL、日志或审计。

## 7. 验证

自动验证：

1. Contracts test/typecheck/build。
2. API migration/entity/profile/presign/merge 单测；customer、auth isolation、WeChat auth、真实 MySQL merge e2e；typecheck/lint/build。
3. Miniapp source-boundary、api-client upload、profile controller、wiring、bridge、build-check；`verify` 与受控 URL build。
4. H5 bridge/coordinator/profile/store/router tests；typecheck/lint/build。
5. Admin users tests、typecheck/lint/build。
6. 根级 lint/typecheck/test/build/format:check 与 `git diff --check`。

唯一环境集成：

- 顾客 A presign/upload/save 成功，B 不能采用 A 的 key；未上传、超限、伪 MIME、非图片对象均拒绝；失败不覆盖旧头像。
- 更新后 `GET /me`、下一次微信登录 session、H5 profile、Admin 手动刷新一致。
- 跳过不撤销登录，同一 session 不重复弹；下次新登录仍提示。

真实宿主：

- 微信开发者工具稳定版和 iOS/Android 真机验证 chooseAvatar、nickname 建议、取消、系统返回、断网、上传失败/重试、合法域名和 5 MiB 限制。
- Safari 15/WKWebView 验证启动、bridge、URL scrub、profile refresh；不新增未保护的受限 API。

发布顺序：migration → API/contracts → H5/Admin → 小程序；新旧版本保持向后兼容。回滚不自动删除对象，migration down 仅在接受失去 object key 所有权信息时执行。
