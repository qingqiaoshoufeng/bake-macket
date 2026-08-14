---
name: frontend-runtime-compat
description: 在编写、修改或审查任何会运行于浏览器、微信 web-view 或原生小程序 JavaScript Runtime 的 JavaScript / TypeScript / Vue 代码时必须使用。尤其是 apps/h5-store、apps/admin-web、apps/miniapp-shell，以及新增或使用 Object/Array/Promise/crypto 等内建 API、Web API、ES2021+ 方法、构建 target、polyfill、用户代理兼容或白屏排障时。区分现代语法风格与运行时 API 支持，默认覆盖 Safari/iOS WKWebView 15.0 和微信开发者工具 WebView；不得用 TypeScript target/lib 或 Vite 编译成功证明运行时兼容。
---

# 前端运行时兼容

现代、函数式代码仍必须在目标宿主中真实可运行。语法可以被 Vite/esbuild/TypeScript 转换，但 `Object.hasOwn`、`structuredClone`、`crypto.randomUUID` 等运行时 API 不会因此自动出现。

## 适用基线

除非权威产品规格明确提高最低版本，否则按以下基线审查生产代码：

- `apps/h5-store/`：Safari / iOS WKWebView 15.0 及微信内嵌 `web-view`。
- `apps/admin-web/`：Safari 15.0；若功能明确只支持桌面浏览器，必须在规格和验收中写明，而不是默认排除移动 Safari。
- `apps/miniapp-shell/`：读取 `project.config.json` / `project.private.config.json` 中声明的基础库版本，并使用微信开发者工具当前稳定版与微信原生 JavaScript Runtime 验证；未声明具体版本时不得自行假定支持新 API。
- Android 微信 WebView：当前项目尚未锁定最低 X5/Chromium 版本；涉及 Android 专属 API 或兼容性时，先取得产品基线或以实际验收设备为准，不得用 iOS 结果代替。
- Node-only scripts 和 Vitest specs 可以使用项目 Node 版本支持的 API，但不得把这些写法无审查复制进浏览器或小程序生产源码。

## 硬规则

### 1. 先判断宿主，再选 API

修改 `.ts`、`.vue`、`.tsx`、`.js` 或 `.mjs` 前，先把文件归入：

1. Node-only；
2. 现代桌面浏览器；
3. Safari / iOS / 微信 H5 WebView；
4. 原生微信小程序 Runtime；
5. 跨宿主共享代码。

跨宿主代码按能力最低的宿主设计，或通过显式 adapter 分开实现。

### 2. 不把编译配置当作运行时证明

- TypeScript `target` / `lib` 只控制语法输出和可用类型，不保证设备实现对应 API。
- Vite/esbuild `build.target` 主要转换语法，不自动 polyfill 新内建 API。
- `typecheck`、`build` 和现代 Chrome 通过，不能证明 Safari 15 或微信 WebView 通过。
- Browserslist 只是目标声明；只有实际接入 compat lint、转译器或 polyfill 后才产生机器约束。

### 3. 新内建 API 必须有支持证据

在浏览器、小程序或共享生产代码中新增以下内容时，必须检查最低宿主支持版本：

- `Object.*`、`Array.*`、`Promise.*`、`String.*`、`Map.*`、`Set.*` 的新方法；
- `structuredClone`、`crypto.*`、`URL*`、`Intl.*` 等 Web/内建 API；
- ES2021+ 方法和新的 DOM/CSS 能力。

直接调用仅在以下任一条件成立时允许：

1. 支持矩阵证明所有目标宿主原生支持；
2. 应用入口在业务代码之前加载了经过测试的 polyfill；
3. 调用有能力检测、兼容 fallback，并有测试实际禁用原生 API 后覆盖 fallback。

### 4. Safari 15.0 基线下的受限 API

生产代码不得未经保护直接调用：

- `Object.hasOwn`
- `structuredClone`
- `crypto.randomUUID`
- `Array.prototype.at`
- `Array.prototype.toSorted` / `toReversed` / `toSpliced` / `with`
- `Object.groupBy` / `Map.groupBy`
- `Promise.withResolvers`

这不是完整黑名单。遇到不熟悉的新 API 时必须查询兼容性，而不是因为它能通过 TypeScript 就使用。

### 5. 优先现代且兼容的封装

兼容不是退回命令式 ES5。保留 ES6-first、不可变和组合式风格，但将宿主差异封装到小型命名 helper 中。

#### 自有属性

```ts
export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
```

不要用：

```ts
Object.hasOwn(value, key); // Safari 15.0–15.3 缺失
value.hasOwnProperty(key); // 可能被覆盖，或对象无原型
key in value; // 会把原型链属性当作自有属性，语义不同
```

`Object.prototype.hasOwnProperty.call` 虽源自早期标准，但在这里是封装边界中的稳定兼容原语；不要为了“看起来更新”改成分配数组的 `Reflect.ownKeys(value).includes(key)`。

#### 不可变排序

```ts
const sorted = [...items].sort(compareItems);
```

不要在 Safari 15 基线中直接使用：

```ts
items.toSorted(compareItems);
```

#### 深拷贝

- 先判断是否真的需要深拷贝；优先构造领域对象或浅拷贝。
- JSON DTO 可使用一个明确命名并说明限制的 `cloneJsonValue` helper；输入类型必须收窄为严格 `JsonValue`，并明确拒绝或处理 `undefined`、`BigInt`、`NaN`、稀疏数组和循环引用，不能让 native 与 fallback 静默产生不同语义。
- 需要 Date、Map、Set、循环引用等完整语义时，使用经过测试的 polyfill/库或 capability detection；不要静默改变语义。
- 不得在浏览器生产代码中把裸 `structuredClone` 当作默认建议。

#### UUID

- H5/Admin：复用共享 UUID helper；优先 `crypto.randomUUID`，fallback 使用 `crypto.getRandomValues`，并测试 UUID v4 的 version 位与 RFC variant 位。
- 原生小程序：使用 `wx.getRandomValues` 封装。
- 幂等键不得用 `Math.random()` 作为无提示的正常路径；若安全随机源不可用，应明确失败或按权威规格处理。

### 6. 启动路径比普通交互更严格

以下代码一旦异常会造成整页白屏，必须提供旧运行时回归测试：

- 应用入口和 router mount 前逻辑；
- URL/query 解析；
- 鉴权和小程序 handoff；
- store hydrate；
- 首屏同步初始化；
- polyfill 加载之前执行的代码。

测试不能只在 Node 22 的完整全局环境中跑正常路径。应临时禁用目标 API，例如：

```ts
const originalDescriptor = Object.getOwnPropertyDescriptor(Object, 'hasOwn');
Object.defineProperty(Object, 'hasOwn', {
  configurable: true,
  value: undefined,
});

try {
  // 执行真实启动路径并断言页面/消息仍正常
} finally {
  if (originalDescriptor) {
    Object.defineProperty(Object, 'hasOwn', originalDescriptor);
  } else {
    Reflect.deleteProperty(Object, 'hasOwn');
  }
}
```

### 7. 诊断白屏时先构造最小差分

按以下顺序缩小问题：

1. 同域纯静态 HTML，无 JavaScript、无 API；
2. 生产静态构建，排除 Vite dev/HMR；
3. 带真实启动参数的应用入口；
4. 读取 WebView console/network；
5. 根据 User-Agent/真实宿主禁用可疑 API建立回归测试。

静态页正常而应用白屏时，优先检查 Vue mount 之前的同步异常和运行时 API，而不是继续修改业务接口。

## 实施流程

1. 识别文件的运行宿主和最低版本。
2. 列出本次新增或触碰的内建/Web API。
3. 查现有共享 helper，禁止跨模块重复实现 fallback。
4. 对未知 API 查询当前兼容资料；记录最低支持版本。
5. 若低于基线，选择：兼容 helper、能力检测 + fallback、正式 polyfill，或经用户/规格批准提高基线。
6. 为 fallback 写会禁用原生 API 的测试，先观察失败，再实现。
7. 运行受影响包的 test、typecheck、lint、production build。
8. 启动、登录、URL handoff、首屏与 WebView 路径必须运行真实宿主或最接近宿主的 smoke test；普通交互按改动影响选择定向 Safari/WebView smoke，避免机械扩大验证。
9. 必要时检查构建产物，确认未保留超出基线的直接调用。

## 审查清单

- [ ] 已明确代码运行于 Node、浏览器、Safari/微信 WebView 或原生小程序。
- [ ] 未把 TypeScript `target` / `lib`、Vite build 成功或现代 Chrome 结果当作兼容证明。
- [ ] 新增内建/Web API 已核对最低运行时。
- [ ] Safari 15 受限 API 未直接进入生产代码，或已有 polyfill/能力检测和测试。
- [ ] fallback 保持原语义；没有用 `in` 替代自有属性判断等语义漂移。
- [ ] 兼容 helper 已集中复用，没有跨 H5/Admin/miniapp 重复散落。
- [ ] 启动路径有“禁用原生 API”的回归测试。
- [ ] 原生小程序使用 `wx.*` 宿主能力，H5/Admin 使用 Web API adapter。
- [ ] production build 和真实/近似 WebView smoke 已验证。
- [ ] Node-only 测试里的现代 API没有无审查复制到生产源码。

## 输出要求

完成前端代码任务时，在验证结果中简要说明：

- 目标运行时基线；
- 新增/触碰的兼容敏感 API；
- 采用的 helper/polyfill/fallback；
- 旧运行时测试与 production build 结果。
