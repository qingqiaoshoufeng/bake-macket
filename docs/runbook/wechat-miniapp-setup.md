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

`MINIAPP_H5_URL` 是唯一受信任的 H5 基准地址，只允许根 pathname `/`（可带 query/hash）。构建会同时生成规范化的 HTTPS base URL 与 origin；手机号授权 `returnUrl` 可使用该 origin 下任意应用 path，但必须保持协议、规范化 host/port 精确同源，且不得包含 username/password 或畸形百分号编码。

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

1. index 初始显示加载态，不渲染 `web-view`。
2. `onLoad` 调用 `wx.login`。
3. 成功且 code trim 后非空时，把以下一次性参数加到受控 `MINIAPP_H5_URL`，再渲染 `web-view`：
   - `miniappSource=bake-miniapp`
   - `miniappType=WECHAT_CODE`
   - `wechatCode=<一次性 code>`
4. 登录失败或 code 为空时 toast，并可加载不带空 code 的基准 H5。
5. H5 在应用入口、router mount 前全局安装一次 bridge；先用 `history.replaceState` 清除全部 handoff 参数并保留 path、其他 query/hash，再把严格 union 校验后的消息发布到仅内存 hub。即使消息无效或业务消费者抛错，敏感参数也已清理；Login 只订阅 hub，仍可消费订阅前缓存的一条待处理消息。

`wx.login` code 是一次性的。手机号授权返回后不会复用之前的 login code；需要新的登录 code 时应重新调用 `wx.login`。

### 4.2 H5 请求手机号授权

1. Login 页面提供“使用微信手机号授权”按钮。
2. H5 在需要小程序能力时，才从微信官方域名动态、非阻塞地加载 `https://res.wx.qq.com/open/js/jweixin-1.3.2.js`。同一时刻的调用复用一个加载请求；加载失败、超时或加载后 `wx.miniProgram` 尚不可用时会清理本次状态，以便下次调用重新注入。部署 CSP 必须至少允许该官方 script origin，且不得改用来源不明的镜像。
3. H5 调用官方 WebView JS SDK 的 `wx.miniProgram.navigateTo`，进入 `/pages/phone-auth/index`，并把当前完整 H5 URL 编码为 `returnUrl`。完整小程序 route 保守限制为最多 1024 字符；超限时不调用 `navigateTo`。
4. `navigateTo` 只在 `success` 回调后返回成功；`fail`、同步抛错、非小程序浏览器或不支持该能力均返回 `false` 并给出提示。
5. 原生授权页对 `query.returnUrl` 最多执行一次显式 `decodeURIComponent`：若微信框架已给出 `https://` 明文则不再解码；空值、解码失败、双重编码或不同源地址会 toast 并禁用授权按钮。
6. 原生授权页只通过用户点击 `button open-type="getPhoneNumber"` 获取手机号动态 code；不能自动弹出或由 `bindmessage` 即时触发。
7. 仅当 `errMsg === 'getPhoneNumber:ok'`、`errno` 为 `0`（或未提供）且现代 `event.detail.code` trim 后非空时，才写入 App 内存 handoff `{ credential, returnUrl }` 并 `wx.navigateBack`。拒绝、失败、旧 `encryptedData` 或空 code 只 toast，不写入空值。
8. index `onShow` 先 `peek` handoff，再 `setData({ showWebView: false })` 销毁旧 `web-view`，在 callback 内设置新 URL 并重新显示；仅重建完成后才 consume。若同步 `setData` 抛错或启动重建失败，credential 仍保留供后续 `onShow` 重试。H5 收到后立即清 URL。

App 不保存商城 JWT，不调用 `wx.setStorage`，只在内存中保留一次性手机号 handoff。

H5 仍保留严格校验的 `window.message` listener，供开发测试或未来兼容；它不是当前生产传输主通道。

## 5. 当前发布阻塞

本任务只交付真实可运行的传输层和最小产品入口，当前不能声称微信登录/手机号绑定端到端完成。发布前必须由 API 服务端实现并接通：

- 使用 `wx.login` 一次性 code 调用微信服务端接口换取 session/openid；
- 使用 `getPhoneNumber` 返回的现代动态 code 调用微信服务端接口换取手机号并完成绑定；
- 服务端错误处理、code 防重放/过期处理与安全日志脱敏；
- H5 调用上述后端接口并更新现有登录/用户状态。

目前 H5 收到 `WECHAT_CODE` 或 `PHONE_CREDENTIAL` 只提示“已收到，等待服务端联调”，不会虚构已换取 session 或已绑定手机号。

## 6. 真机验收清单

微信开发者工具模拟结果不能替代真机。使用具备 `getPhoneNumber` 权限的正式或测试 AppID：

1. 用根路径正式 HTTPS URL 执行 miniapp `build`，直接导入 `apps/miniapp-shell`，确认 TypeScript 插件正常编译且未关闭域名校验；触发小程序能力后确认 H5 动态加载官方 JSSDK，部署 CSP 未阻断 `res.wx.qq.com`。
2. 清理状态后打开小程序：index 先显示加载态；`wx.login` 成功后才加载 H5；地址中不得出现空 `wechatCode`。
3. H5 消费登录 handoff 后，确认地址栏敏感参数已清理，其他 query/hash/path 保留。
4. 点击 Login 页“使用微信手机号授权”，确认实时进入独立原生页，而不是等待 `bindmessage`。
5. 点击原生 `getPhoneNumber` 按钮授权，返回后确认旧 `web-view` 先销毁再重建、H5 收到手机号 credential 并清理 URL；再次 `onShow` 不得重复消费。
6. 在开发者工具中让首次 `setData` 同步失败，确认 handoff 未被永久消费，后续 `onShow` 可重试交付。
7. 拒绝手机号授权时只 toast，不写 credential、不返回空 handoff；空/坏编码/双重编码 `returnUrl` 必须禁用授权按钮。
8. 构造异源、HTTP、含 username/password、不同端口或畸形 `%` 的 `returnUrl`，确认 index 拒绝加载；同源任意应用 path 可返回。
9. 构造超过 1024 字符的完整 phone-auth route，确认不调用 `navigateTo`；分别测试 `navigateTo` success、fail 与同步抛错。
10. 分别测试 `wx.login` 失败、空 login code、H5 加载失败、非小程序浏览器点击手机号入口和网络断开，确认无未处理异常或无限重试。
11. 接通服务端后再验收 code 换 session、手机号换取/绑定、过期与重放、日志脱敏；服务端链路未完成时禁止发布微信登录/手机号绑定能力。
12. 提交前运行 `git status`，确认 `config/h5.generated.js`、`project.private.config.json`、真实 URL、AppID/AppSecret 均未进入版本控制。
