# 微信小程序 H5 容器配置

本文说明如何配置并真机验证 `apps/miniapp-shell`。仓库只提交安全模板，不提交真实 H5 URL、AppID、AppSecret 或其他密钥。

权威历史计划曾设想使用 `WebViewContext.postMessage` 从小程序向 H5 发送消息，但微信小程序没有 `wx.createWebViewContext` / `WebViewContext.postMessage` API。`web-view bindmessage` 只接收 H5 通过 `wx.miniProgram.postMessage` 发往小程序的数据，而且只在后退、组件销毁、分享等特定时机触发，不适合作为即时手机号授权入口。因此当前实现使用可运行的“受控 URL handoff + 独立原生授权页”协议。

## 1. 准备 HTTPS 服务与域名

上线前逐项确认：

- H5 商城使用有效 HTTPS 证书，并可由公网访问。
- API 使用 HTTPS；H5 不得通过明文 HTTP 请求 API。
- 腾讯云 COS 源站或 CDN 公网地址使用 HTTPS。
- 微信公众平台的“开发管理 → 开发设置 → 服务器域名”分别配置：
  - `request` 合法域名：API 域名；
  - `uploadFile` 合法域名：COS 上传或上传代理域名；
  - `downloadFile` 合法域名：COS/CDN 下载域名；
  - `web-view` 业务域名：H5 商城域名，并完成域名所有权校验。
- 域名配置与最终 URL 的协议、主机和端口一致；生产环境不得关闭合法域名校验。

`MINIAPP_H5_URL` 是唯一受信任的 H5 基准地址，只允许根 pathname `/`（可带 query/hash）。构建会同时生成规范化的 HTTPS base URL 与 origin；显式微信登录和保留的独立手机号能力，其 `returnUrl` 均只可使用该 origin 下应用 path，必须保持协议、规范化 host/port 精确同源，且不得包含 username/password、反斜杠、控制字符、嵌套编码或畸形百分号编码。

## 2. 构建与开发者工具导入

原生小程序运行时不读取 `process.env`。正式构建读取 `MINIAPP_H5_URL`，严格校验后生成被 Git 忽略的 `apps/miniapp-shell/config/h5.generated.js`：

```bash
MINIAPP_H5_URL=https://mall.example.com/ pnpm --filter @bake-mall/miniapp-shell build
```

Windows PowerShell：

```powershell
$env:MINIAPP_H5_URL = 'https://mall.example.com/'
pnpm --filter @bake-mall/miniapp-shell build
```

正式 `build` 缺少变量、使用 HTTP、包含 URL 凭据、使用非根 pathname（例如 `/shop/`）或提供无效 URL 时会失败，不会生成 fallback。无环境变量的静态检查使用：

```bash
pnpm --filter @bake-mall/miniapp-shell build:check
```

`build:check` 只 typecheck 并验证模板、`miniprogramRoot`、页面注册与 TypeScript 编译插件，不生成或覆盖正式 URL。根 `pnpm build` 对其他 workspace 正常执行 `build`，对 miniapp 只执行 `build:check`，因此不需要 `MINIAPP_H5_URL`，也不会双跑或覆盖 miniapp 生成配置。

`project.config.json` 已设置：

- `miniprogramRoot: "./"`，微信开发者工具可直接导入 `apps/miniapp-shell`；
- `setting.useCompilerPlugins: ["typescript"]`，由开发者工具编译 `.ts` 源码；
- 正式 URL 配置与开发者私有设置均不提交。

## 3. AppID、AppSecret 与官方类型

1. 复制 `apps/miniapp-shell/project.private.config.example.json` 为 `project.private.config.json`。
2. 在私有文件或开发者工具项目设置中填写正式/测试 AppID。
3. AppSecret 只放在 API 服务端密钥管理或环境变量中，例如：

```text
WECHAT_APP_ID=<正式 AppID>
WECHAT_APP_SECRET=<正式 AppSecret>
```

4. 小程序使用官方 `miniprogram-api-typings`，不得手写声明不存在的微信 API。执行 `pnpm --filter @bake-mall/miniapp-shell typecheck` 会实际加载官方类型。
5. AppSecret 不得下发到 H5、小程序、构建产物、前端日志或客户端 storage。

## 4. 实际桥接协议

### 4.1 小程序向 H5 传登录 code

自动快捷路径：

1. index 先加载基准 H5；匿名 H5 在启动阶段生成安全随机一次性 `state`，写入带 10 分钟过期时间的 pending login 状态，并通过 `wx.miniProgram.navigateTo` 打开原生微信登录页。
2. 原生页校验 `returnUrl` 同源并携带该 `state`，自动模式立即调用 `wx.login`；成功且 code trim 后非空时，把 `{ code, returnUrl, state }` 写入 App 内存，再返回 index。
3. index 把 `miniappSource=bake-miniapp`、`miniappType=WECHAT_CODE`、`wechatCode=<一次性 code>`、`wechatState=<一次性 state>` 加到受控同源 URL **fragment**（`#` 后）并重建 `web-view`；fragment 不会发送给外层入口、Nginx、WAF 或 API。H5 只有在 state 与当前浏览器 pending login 匹配、未过期且未消费时才兑换 code。

显式用户路径：

1. H5 Login 页面始终显示“微信登录/重新微信登录”；只调用 `wx.miniProgram.navigateTo` 打开 `/pages/wechat-login/index`，H5 不调用 `wx.login`。
2. H5 同样先生成并保存一次性 `state`；原生页严格校验编码后的 `returnUrl` 与 `MINIAPP_H5_URL` 同源，并要求 state 非空。用户点击后才调用新的 `wx.login`，将 `{ code, returnUrl, state }` 写入 App 内存，不写 storage，再 `navigateBack`。
3. index `onShow` 优先观察显式 handoff，创建单调 `deliveryId`，销毁并重建 web-view；只有匹配 `deliveryId` 的 `bindload` 才消费该内存值。加载错误保留 handoff 供再次交付；显式 handoff 已观察时，较晚返回的自动登录结果不得覆盖它。
4. H5 在应用入口、router mount 前先 hydrate 持久会话并启动唯一应用级微信认证协调器，再安装 bridge。bridge 使用 `history.replaceState` 清除 fragment 中全部 handoff 参数并保留 path、普通 query/hash，然后把严格 union 校验后的 `WECHAT_CODE` 发布到仅内存 hub；自动和显式请求使用 latest-attempt single-flight，同一时刻最多导航一次，均由同一协调器调用 `/auth/wechat/login`。
5. 受保护路由只等待当前正在进行的微信 code 兑换；公开首页和商品页不会因微信网络请求阻塞挂载。

`wx.login` code 是一次性的，只存在原生 App 内存与一次性同源 URL handoff，不进入 localStorage、sessionStorage、小程序 storage、日志、审计或响应。H5 localStorage 仅暂存不含身份信息的随机 state 与创建时间，匹配/过期/导航失败后清理；无匹配 state 的 code 不得兑换。兑换失败后必须通过新的 `wx.login` 获取新 code。

### 4.2 头像昵称资料完善

1. 微信登录成功且昵称或受管理头像缺失时，H5 每个登录会话最多打开一次 `/pages/profile-completion/index`；用户可选择“稍后设置”，不影响已建立的商城会话，下次新登录仍可提示。
2. 原生页使用 `button open-type="chooseAvatar"` 与 `input type="nickname"`。头像临时路径只保留在页面内存；昵称 trim 后必须为 1–64 字符。
3. 原生页使用新的 `wx.login` 建立仅在 App 内存中的独立 customer session，然后请求 `POST /me/profile/avatar/presign`。头像支持 JPEG/PNG/WebP，最大 5 MiB。
4. `wx.uploadFile` 的目标来自 `OBJECT_STORAGE_CLIENT_ENDPOINT` 签名；该域名必须稳定、HTTPS，并登记为微信 `uploadFile` 合法域名。API 内部读取仍使用 `OBJECT_STORAGE_ENDPOINT`，两者可以不同但必须指向同一 bucket。
5. 上传后仅向 `PATCH /me/profile` 提交当前用户命名空间的 object key；服务端验证对象存在、大小、MIME 与图片魔数，并派生公开 URL。
6. 完成或跳过只通过 App 内存 handoff 返回 `PROFILE_UPDATED` / `PROFILE_SKIPPED`，不携带 JWT、昵称、头像 URL、object key 或上传签名。完成后 H5 使用自己的 JWT 重新请求 `GET /me`。
7. “我的”页可再次打开同一原生页面修改头像昵称；头像下载域名必须登记为 `downloadFile` 合法域名。

### 4.3 三类手机号与订单快照

1. `User.phone` 是唯一的历史身份手机号，可参与身份归一和保留的会员验证；不得由履约资料修改。
2. `User.orderContactPhone` 是非唯一的订单履约手机号，另有 `orderContactPhoneVersion`。顾客在 H5“我的”页设置或修改；Profile 只持久化脱敏值和 version，完整号码只存在 PUT 请求生命周期，不进入 auth profile/localStorage。
3. `AdminUser.loginPhone` 是唯一的 OPERATOR PC 登录手机号，仅由 SUPER_ADMIN 授权时配置；它与上述两个 User 字段互不替代。
4. `/checkout` 只展示脱敏订单联系号和修改入口，不再接收完整手机号。创建订单仅提交 `orderContactPhoneVersion`；H5 将版本纳入请求指纹，资料变化后生成新 `Idempotency-Key`。
5. API 保持 completed replay 优先；新订单事务按统一顺序锁 User，校验 active、未合并、联系号已配置且 version 匹配，再把服务端完整值冻结到订单不可变快照。Profile 更新与下单共用该 User 行锁；地址手机号不作 fallback。
6. 顾客购物和 OPERATOR 均不要求 `phoneVerified=true`，也不调用收费的 `getPhoneNumber`。若会员继续使用 `/auth/wechat/phone`，它是独立顾客能力；`/pages/phone-auth/index?flow=admin` 已从管理员路径移除。

低层 H5 `PHONE_CREDENTIAL` handoff 可暂留用于独立会员能力和兼容清理，但管理员与商品订单没有入口或业务消费者。App 不保存商城 JWT，不调用 `wx.setStorage` 保存 code、凭证或会话。

## 5. 当前发布状态

微信登录服务端链路已接通：API 使用 `wx.login` 一次性 code 调用微信 `jscode2session`，并具备凭证防重放、确定性失败快照和安全错误映射。自动登录与显式原生 handoff 都复用该链路。

OPERATOR 必须由 SUPER_ADMIN 对已具有微信 OpenID/UnionID 的 User 显式授权，同时配置独立 `AdminUser.loginPhone` 与临时密码。小程序直接按 linked User 资格交换 `mall-admin` 会话；撤权使 OPERATOR inactive 并递增 token version，linked User 停用、合并或失去微信身份时 exchange/guard 立即拒绝。顾客购物和管理员能力均不依赖微信手机号付费额度。

## 6. 真机验收清单

微信开发者工具模拟结果不能替代真机，且 iOS 微信 WebView 结果不能代替 Android 微信内核。使用正式或测试 AppID：

1. 用根路径正式 HTTPS URL 执行 miniapp `build`，直接导入 `apps/miniapp-shell`，确认基础库最低版本 3.17.1、TypeScript 插件正常编译且未关闭域名校验。
2. 清理状态后打开小程序：index 加载基准 H5，匿名启动通过 H5 state 绑定的原生页自动取得 `wx.login` code；返回地址必须同时包含非空 `wechatCode`/`wechatState`，H5 消费后立即清理。
3. 不进入 Login 页面，确认应用级协调器只调用一次 `/auth/wechat/login`；地址栏已清理敏感参数，其他 query/hash/path 保留。
4. 清商城 session 后进入 Login，点击显式“微信登录”：确认原生页严格同源、state 与当前 H5 pending login 一致、用户点击后取得新 code、返回原 redirect，App storage 与日志均无 code；伪造/重复/过期 state 均不兑换，只有匹配 `deliveryId` 的 web-view load 消费 handoff。
5. 使用 `phone=null, phoneVerified=false` 的微信用户进入购物车与 checkout，确认不会被送往手机号授权页；未配置订单联系号时引导到“我的”。
6. 在“我的”保存合法订单联系号后返回 checkout，只显示脱敏值且 POST `/orders` 不包含完整号码；修改资料后旧订单快照不变，新订单使用新值，stale version 明确提示刷新。
7. 若会员能力仍保留，单独验证未验证用户购买会员返回 `PHONE_REQUIRED`；不要把该结果外推到购物或管理员。
8. 由 SUPER_ADMIN 为已绑定微信身份的 User 配置独立管理员登录手机号和临时密码。确认 OPERATOR 可直接进入门店管理和 exchange，不进入 `flow=admin`、不调用 `getPhoneNumber`；未授权用户不显示管理入口。
9. 撤权、linked User 停用/合并/清理微信身份后，现有管理 token 与新 exchange 立即失败；修改订单联系号或历史身份手机号不影响管理员会话。
10. 分别测试 `wx.login` 失败、空 login code、显式原生页重试、H5 加载失败和网络断开，确认无未处理异常、启动白屏、敏感凭证持久化或无限重试。
11. 提交前运行 `git status`，确认 `config/h5.generated.js`、`project.private.config.json`、真实 URL、AppID/AppSecret 均未进入版本控制。
