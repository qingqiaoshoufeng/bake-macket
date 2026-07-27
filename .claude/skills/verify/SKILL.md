---
name: verify
summary: 运行 bake-mall 的 API、H5 与 Admin 真实表面并捕获验收证据
---

# Bake Mall 运行时验收

## 启动

1. 使用 Node 22：`PATH=$HOME/.nvm/versions/node/v22.23.1/bin:$PATH`。
2. 先检查 `launchctl print gui/$(id -u)/com.claude.bake-mall-dev`；若该会话级 job 指向当前 worktree 且会与本次手工启动冲突，执行 `launchctl bootout gui/$(id -u)/com.claude.bake-mall-dev`。
3. 运行 `pnpm dev`；它复用 MySQL/MinIO、执行迁移并启动 API `3015`、H5 `5173`、Admin `5174`。
4. API 健康路径是 `http://127.0.0.1:3015/api/v1/health`，不是 `/health`。

## 浏览器驱动

仓库未安装 Playwright 时，使用系统 Chrome 的隔离 CDP 会话：

```bash
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --headless=new --remote-debugging-port=9230 \
  --user-data-dir=/tmp/bake-chrome-profile --disable-gpu about:blank
```

通过 CDP `Runtime.evaluate` 点击真实 DOM、填写表单，并用 `Page.captureScreenshot` 保存截图。Admin 本地凭据为 `admin-local@example.com / admin-password`，H5 开发登录为任意合法手机号配合 `123456`。

重点流程：

- Admin `/banners` 创建/编辑/上下架后，从 H5 `/` 点击 Banner 验证跳转。
- H5 商品详情选择可售 SKU，登录后加入购物车，经 `/cart`、`/checkout` 创建自提订单，再观察 `/orders/:id` 和 `/orders`。
- Admin `/orders` 验证筛选、快照与 `NEW → PROCESSING → {COMPLETED | CANCELLED}`。

## 停止与清理

中断 `pnpm dev` 后确认 `3015/5173/5174` 无监听；`pnpm services:ps` 应仍显示 MySQL/MinIO healthy。临时 Banner 用正式 Admin DELETE 清理；订单是不可变业务记录，不直接删库。
