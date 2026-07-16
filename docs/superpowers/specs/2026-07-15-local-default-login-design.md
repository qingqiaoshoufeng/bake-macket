# 本地开发默认登录与项目启动设计

**日期：** 2026-07-15  
**状态：** 已批准  
**范围：** 本地开发环境启动、admin-web 与 h5-store 登录页默认填充

## 1. 背景

当前两个前端登录页的表单初始值均为空。H5 商城已经提供非生产环境的快捷填充入口，值为 `13800000000 / 123456`；商家后台依赖 API 从 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 初始化管理员，但仓库没有可直接使用的本地管理员配置。

此外，两个 Vite 应用均将 `/api` 代理到 `127.0.0.1:3015`，API 未配置 `PORT` 时则默认监听 `3000`。按当前默认配置启动时，前端无法访问 API。

本设计仅解决本地开发启动与默认填充，不修改身份协议、JWT 隔离、生产凭据管理或业务页面。

## 2. 目标

1. 在本地启动完整项目后，两个前端登录页都直接显示可用的开发凭据。
2. H5 商城默认显示手机号 `13800000000`、验证码 `123456`。
3. 商家后台默认显示邮箱 `admin@example.com`、密码 `admin-password`。
4. 两套凭据都能通过真实 API 完成登录。
5. 生产构建不自动填充任何开发凭据。
6. 本地管理员密码不提交到 Git，不写入迁移或后端源代码。
7. 保留并避开现有 `CategoryTable.vue` 未提交修改。

## 3. 非目标

- 不修改用户或管理员的 JWT audience、密钥、守卫和 token 存储方式。
- 不新增通用账号管理或密码重置能力。
- 不把管理员密码硬编码到 Vue、TypeScript、迁移、测试 fixture 或已提交环境示例中。
- 不修复与登录无关的对象存储环境变量命名。
- 不重构根目录 `pnpm dev` 或分类管理页面。
- 不改变生产环境的开发验证码禁用规则。

## 4. 方案

采用“本地环境文件 + 开发态表单初始化”方案。

### 4.1 API 本地配置

在被 Git 忽略的本地环境配置中提供：

```dotenv
PORT=3015
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin-password
```

API 继续使用现有管理员初始化逻辑：启动时读取 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`；当邮箱不存在时，对密码进行 bcrypt 哈希并创建启用的管理员。不得修改该逻辑以覆盖已存在管理员的密码。

`PORT=3015` 使 API 与 admin-web、h5-store 现有 Vite 代理保持一致，不需要改动两个代理配置。

### 4.2 admin-web 默认填充

admin-web 使用仅本机存在的 Vite 环境变量：

```dotenv
VITE_ADMIN_EMAIL=admin@example.com
VITE_ADMIN_PASSWORD=admin-password
```

登录页的初始值遵循以下规则：

- `import.meta.env.DEV` 为 `true` 时，从 `VITE_ADMIN_EMAIL` 和 `VITE_ADMIN_PASSWORD` 读取初始值；
- 任一变量缺失时，对应输入框退化为空字符串；
- 生产构建始终以空字符串初始化，不得因环境变量存在而自动填充；
- 提交行为、错误提示、redirect 校验和 `sessionStorage` token 隔离保持不变；
- 页面中的配置说明改为与后端实际配置一致的名称，避免继续引用不存在的 `BOOTSTRAP_ADMIN_EMAIL` 和 `BOOTSTRAP_ADMIN_PASSWORD`。

由于所有 `VITE_*` 变量都会编译进浏览器资源，此机制只用于本地开发便利，不能承载生产秘密。

### 4.3 h5-store 默认填充

H5 登录页复用现有 `DEVELOPMENT_LOGIN_HINT`：

- 开发环境初始手机号为 `DEVELOPMENT_LOGIN_HINT.phone`；
- 开发环境初始验证码为 `DEVELOPMENT_LOGIN_HINT.code`；
- 生产环境两个初始值均为空字符串；
- 保留现有开发快捷入口，避免引入第二套凭据常量；
- 后端继续只在非生产环境接受固定验证码 `123456`。

## 5. 数据流

### 5.1 管理员登录

1. 本地 API 启动并读取 `ADMIN_EMAIL`、`ADMIN_PASSWORD`。
2. API 在数据库迁移完成后初始化 `admin@example.com` 管理员。
3. admin-web 开发服务器读取本地 `VITE_ADMIN_EMAIL`、`VITE_ADMIN_PASSWORD`。
4. `/login` 页面以这两个值初始化表单。
5. 用户提交后，现有 store 请求 `POST /api/v1/admin/auth/login`。
6. Vite 将请求代理到 `http://127.0.0.1:3015`。
7. 登录成功后，管理员 token 写入 `sessionStorage` 的 `bake_admin_token`，页面跳转到 `/dashboard`。

### 5.2 H5 登录

1. H5 开发构建从现有 `DEVELOPMENT_LOGIN_HINT` 初始化手机号和验证码。
2. 用户提交后，现有 store 请求 `POST /api/v1/auth/dev/login`。
3. API 在非生产环境校验固定验证码 `123456`，并按手机号查找或创建用户。
4. 登录成功后，用户 token 写入 H5 自己的本地存储键，不读取管理员 token。
5. 页面返回原受保护流程或进入商城页面。

## 6. 启动顺序

在 workspace 根目录执行：

1. 确认依赖已安装；必要时执行 `pnpm install`。
2. 执行 `pnpm services:up` 启动 MySQL 8.4 与 MinIO。
3. 使用本地环境配置执行 `pnpm --filter @bake-mall/api migration:run`。
4. 使用相同 API 本地环境启动 `pnpm --filter @bake-mall/api start:dev`。
5. 启动 h5-store 与 admin-web 开发服务器；可使用根递归命令或分别启动。
6. 访问：
   - H5：`http://127.0.0.1:5173/login`
   - 后台：`http://127.0.0.1:5174/login`

API 必须监听 `127.0.0.1:3015` 对应的本地端口，两个前端才能通过现有代理访问它。

## 7. 错误处理与已知边界

### 7.1 管理员已存在但密码不同

现有 seed 逻辑不会更新已存在管理员的密码。如果 `admin@example.com` 已存在且密码不是 `admin-password`，真实登录验证会失败。此时应明确报告本地数据冲突，并采用以下一种本地处理方式：

- 使用一个未存在的新本地管理员邮箱，并同步更新 API 和 admin-web 本地环境变量；或
- 经用户确认后重建本地开发数据库。

不得为了通过验证而修改 seed，使其在每次启动时覆盖密码。

### 7.2 服务未就绪

- 数据库或迁移未就绪：API 启动或管理员初始化失败，应保留错误输出并修复启动顺序。
- API 未监听 `3015`：前端请求将出现代理错误，应检查本地 `PORT`。
- MinIO 未就绪不会阻止纯登录验证，但完整项目启动仍应报告服务状态。
- 端口被占用时，不静默切换前端或 API 端口；应报告冲突并保持代理配置一致。

### 7.3 凭据暴露边界

- `.env` 和应用级 `.env.local` 必须保持被 Git 忽略。
- 不在终端总结中打印除已批准本地开发值以外的任何现有秘密。
- 不将生产管理员密码配置为 `VITE_*` 变量。

## 8. 测试与验收

### 8.1 自动化测试

- admin-web 登录页测试：
  - 开发态配置存在时，邮箱和密码输入框具有对应初始值；
  - 提交仍调用现有登录 store，并传递当前表单值；
  - 不改变 redirect 与错误展示行为。
- h5-store 登录页测试：
  - 开发态以 `DEVELOPMENT_LOGIN_HINT` 初始化；
  - 提交传递 `13800000000 / 123456`；
  - 现有快捷填充入口继续工作。
- 运行两个前端的目标测试、类型检查和构建。

生产态空值应通过将环境判定提取为可测试的配置或通过生产构建检查验证，避免仅依赖人工判断。

### 8.2 真实运行验证

必须启动实际服务并通过浏览器观察：

1. `services:ps` 显示 MySQL 和 MinIO 正常。
2. 迁移成功完成。
3. API 监听 `3015` 且未发生管理员 seed 错误。
4. H5 登录页打开后已显示 `13800000000 / 123456`。
5. H5 提交成功，并能进入需要登录的页面。
6. admin-web 登录页打开后已显示 `admin@example.com / admin-password`。
7. admin-web 提交成功并进入 `/dashboard`。
8. 两端 token 使用各自的存储键，未发生身份串用。

若浏览器驱动不可用，仍需启动服务并通过页面加载和真实 HTTP 登录请求验证；同时明确说明未完成浏览器级观察，不能将单元测试代替端到端结论。

## 9. 文件边界

预计修改范围仅包括：

- admin-web 登录页及其登录测试；
- h5-store 登录页及其登录测试；
- 必要的前端环境类型声明或页面域配置；
- 被 Git 忽略的本地 API/admin-web 环境文件。

实施前必须读取并遵守：

- `.claude/skills/frontend-page-generator/SKILL.md`
- `.claude/skills/js-functional-style/SKILL.md`

明确不得改动或纳入本任务提交：

- `apps/admin-web/src/views/categories/components/CategoryTable.vue`
- `docs/superpowers/plans/2026-07-15-admin-category-management.md`

## 10. 完成标准

满足以下全部条件才可声明完成：

- 两个前端开发登录页均自动显示批准的本地凭据；
- 生产构建不自动填充开发凭据；
- 两套凭据均通过真实本地 API 登录成功；
- API、两个前端和依赖服务的启动地址明确且一致；
- 目标测试、类型检查和构建通过；
- 本地管理员密码未进入 Git；
- 现有分类管理未提交改动保持原样。
