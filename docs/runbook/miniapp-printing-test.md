# 小程序体验版绑定打印机与模拟打印联调

## 范围

本手册用于测试环境验证以下闭环：

```text
微信小程序体验版
  → 花生壳 HTTPS
  → H5 / API
  → NestJS API
  → 本地 fake 芯烨服务或真实芯烨云
```

小程序不持有芯烨云账号、密钥、微信 AppSecret、API 签名或完整打印机 SN。所有芯烨配置只写入本机被 Git 忽略的 `.env.development` 或部署 Secret。

## 1. 微信与 HTTPS 前置条件

1. 微信开发者工具使用 `project.private.config.json` 中的测试 AppID；该文件被 Git 忽略。
2. 在微信公众平台配置：
   - H5 根地址为 `web-view` 业务域名；
   - API 地址为 request 合法域名；
   - HTTPS 证书有效，不能使用 localhost、127.0.0.1 或自签名证书。
3. 花生壳转发到本地 H5 dev server，并将 H5 的 `/api` 代理到本地 API。
4. 记录测试地址时只记录域名，不记录账号、密钥或内网地址。

## 2. 本地配置

在根目录创建被 Git 忽略的 `.env.development`，至少设置：

```dotenv
NODE_ENV=development
HOST=0.0.0.0
PORT=43015
WECHAT_APP_ID=<微信 AppID>
WECHAT_APP_SECRET=<仅本机保存>
XPYUN_USER=local-xpyun-user
XPYUN_USER_KEY=local-xpyun-user-key
XPYUN_BASE_URL=http://127.0.0.1:43999
```

如果使用真实芯烨云，将 `XPYUN_BASE_URL` 改为 `https://open.xpyun.net`，并在本机写入真实账号与轮换后的密钥。不要将密钥传给小程序或写入任何 `config/` 文件。

## 3. 启动顺序

```bash
pnpm services:up
pnpm --filter @bake-mall/api migration:run
pnpm --filter @bake-mall/api printing:fake-xpyun
```

另开终端启动 API 和 H5：

```bash
pnpm --filter @bake-mall/api start:dev
pnpm --filter @bake-mall/h5-store dev
```

fake 服务默认监听：

```text
http://127.0.0.1:43999
```

它只应被 API 访问，不应通过花生壳暴露。

## 4. 生成体验版源码

使用花生壳根 HTTPS 地址生成被忽略的运行时配置：

```bash
MINIAPP_H5_URL=https://<花生壳域名>/ \
  pnpm --filter @bake-mall/miniapp-shell build:check

MINIAPP_H5_URL=https://<花生壳域名>/ \
  pnpm --filter @bake-mall/miniapp-shell build
```

随后在微信开发者工具导入：

```text
apps/miniapp-shell
```

选择本地私有项目配置，确认 AppID 为测试小程序 AppID，再执行预览或上传体验版。上传前确认生成的 `config/h5.generated.js` 和 `config/api.generated.js` 指向花生壳域名；这些文件被 Git 忽略，不要提交。

## 5. 准备商家与订单

数据库中需要一个有效的 OPERATOR 管理员身份，且关联微信用户，拥有：

- `PRINT_DEVICE_MANAGE`
- `PRINT_EXECUTE`
- `PRINT_HISTORY_READ`
- `ORDER_READ`

同时准备至少一笔 `NEW` 或 `PROCESSING` 且带订单明细的测试订单。取消订单不可打印。小程序不会自动消费新订单，必须由商家主动选择并提交。

## 6. 绑定 fake 打印机

在小程序管理区打开“打印机管理”，输入：

```text
SN: FAKE-PRINTER-001
名称: 测试出单机
操作密码: <本机测试操作密码>
```

绑定流程：

1. API 向 fake 芯烨提交添加设备；
2. API 向 fake 芯烨提交验证码小票；
3. 从运行 fake 服务的本地控制台读取六位验证码；
4. 在小程序输入验证码和操作密码；
5. 刷新在线状态，确认设备为 `ACTIVE` 且 `ONLINE`。

控制台不得输出芯烨密钥、签名、完整顾客信息或完整 SN。

## 7. 模拟打印

进入小程序“订单打印”：

1. 选择 `ACTIVE` 且 `ONLINE` 的测试打印机；
2. 选择一笔订单，点击“打印订单”，或选择多笔后点击“批量打印”；
3. 确认二次弹窗；
4. 等待 API 完成打印；
5. 页面显示“厂商已接受”，不要将该状态解释为已确认物理出纸；
6. 查看 `明确失败`、`状态未知`、`人工复核` 计数。

fake 服务收到打印请求后会记录脱敏打印机标识和 fake vendor job id。服务端任务应进入 `ACCEPTED`，批次进入 `COMPLETED` 或相应 issue 状态。

## 8. 失败与幂等验收

至少检查：

- 同一 Idempotency-Key 重放不会再次调用 fake 芯烨；
- `FAILED` 只能通过独立 retry 意图重新生成任务；
- `UNKNOWN` 不会自动重新调用 print；
- 有可信 vendor job id 时可查询收敛；
- 未确认的 UNKNOWN 不允许普通路径绕过重复风险；
- 小程序退出后重新进入仍能看到服务端状态；
- 日志与审计不包含密钥、签名、完整 SN、完整手机号、地址或 payload。

## 9. 自动门禁

```bash
pnpm --filter @bake-mall/contracts test
pnpm --filter @bake-mall/contracts typecheck
pnpm --filter @bake-mall/api test:fake-xpyun
pnpm --filter @bake-mall/api typecheck
pnpm --filter @bake-mall/api lint
pnpm --filter @bake-mall/miniapp-shell test
pnpm --filter @bake-mall/miniapp-shell typecheck
MINIAPP_H5_URL=https://<花生壳域名>/ \
  pnpm --filter @bake-mall/miniapp-shell build:check
```
