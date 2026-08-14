---
name: frontend-page-generator
description: 在生成或重构前端页面（包括 Vue 3 / React + Vite / Vant / Element Plus）时使用此 skill。按 components、hooks、mock、config、type 模块化拆分文件夹，业务逻辑与视图解耦，可配置化的表格列、分页与初始化数据集中在 config，无后端时使用 mock，HTTP 统一走全局 api 入口，type 单独维护且子组件 props 不上提；枚举全局维护。必须同时遵循 js-functional-style 与 frontend-runtime-compat，页面能通过 typecheck/build 不代表 Safari/微信 WebView 运行时兼容。
---

# Frontend Page Generator

Use this whenever Claude Code is asked to create or refactor a front-end page that talks to a backend (or will eventually), especially when the work spans a single domain (orders, products, customers, banners, …). It is framework-agnostic but biased toward the conventions used in the Bake Mall MVP: Vue 3 + Vite + Vant 4 (H5) or Element Plus (admin).

## When to use

- Generating a new CRUD-style page (list + form + detail).
- Splitting an existing monolithic page into modules.
- Reviewing file layout decisions before writing new page code.

## When not to use

- Single trivial component with no domain logic.
- Pure backend or CLI work.

## Module layout

Always split a page module into the following sub-folders under `src/views/<feature>/` (Vue) or `src/<feature>/` (React). Do not colocate these subfolders; treat each as one responsibility.

```
src/views/<feature>/
├── components/        # UI-only view components (no business logic, no fetch)
│   ├── <Feature>Table.vue
│   ├── <Feature>Form.vue
│   └── <Feature>Detail.vue
├── hooks/             # Encapsulated business logic (composition API / React hook)
│   ├── use<Feature>List.ts
│   ├── use<Feature>Submit.ts
│   └── use<Feature>Status.ts
├── mock/              # Local mock fixtures used until the backend is ready
│   ├── list.mock.ts
│   └── detail.mock.ts
├── config/            # Pure-data configuration: columns, pagination, defaults
│   ├── columns.ts
│   ├── pagination.ts
│   └── defaults.ts
├── type/              # View-layer TypeScript types (DTO mapping, form shape)
│   ├── list.ts
│   └── form.ts
├── api/               # Feature-specific api composition on top of the GLOBAL api client
│   └── index.ts
├── <Feature>View.vue  # Entry view: assembles components + hooks
└── index.ts           # Router registration / re-export
```

### components/

- Pure presentational Vue/React components.
- Receive props; emit events.
- **No** `fetch`, no Pinia store, no router navigation beyond `defineEmits`-driven parent feedback.
- Subcomponent props **stay inside the subcomponent**; never lift them to the module barrel or `type/`.

### hooks/

- Encapsulate **complex or cross-cutting logic** (filters, validation chains, async orchestration, computed state machines).
- Component files stay short; everything else goes here.
- Each hook returns a stable shape (`data`, `loading`, `methods`) so views stay declarative.

### mock/

- Temporary fixtures used during scaffolding or e2e isolation.
- Must mirror the contract types in `type/`.
- Once the backend contract is stable, swap the consumer to the real api but keep the mock files for unit tests.

### config/

- Pure-data files: column definitions, default sort, page size presets, palette tokens, validation regexes.
- Anything that a designer or PM wants to tweak without touching component logic.
- Examples:
  - `columns.ts` returns `ColumnDef[]` consumed by `<X>Table`.
  - `pagination.ts` returns `{ pageSizes: [10, 20, 50], defaultPageSize: 20 }`.
  - `defaults.ts` returns form defaults for new entities.

### type/

- View-layer types: list row, form shape, response shape.
- **Do not export child-component props here** — those stay inside the child.
- Re-use `@bake-mall/contracts` DTOs when one exists.

### api/

- Composition layer over the **global** `ApiClient`.
- Per-feature: `list(filter)`, `getOne(id)`, `create(payload)`, `update(id, payload)`, `remove(id)`.
- **Must not** contain request/response data transformations or business mappings — leave those to `hooks/` or `type/`.
- Backing endpoint paths and HTTP method belong here; payload shape belongs in `type/`.

## Coding conventions (delegated)

- This skill **assumes** `js-functional-style` and `frontend-runtime-compat` are available. All code written under it must additionally honour:
  - Pure functions and immutable data.
  - ES6 array helpers (`map`/`filter`/`reduce`/`some`/`every`/`find`) instead of `for`/`forEach`/manual push.
  - Avoid in-place mutation; treat state transitions as "return a new value".
  - When a small library helper (e.g. a `groupBy`) is needed, write it once in `src/utils/` rather than scattering it.
  - Identify the page's browser/WebView runtime before choosing built-in APIs; Vite/TypeScript compilation is not runtime support evidence.
  - For startup, auth, URL handoff and store hydration paths, add a compatibility test that disables any guarded modern API and exercises the real call site.

## Enums

- Enums are **global** and registered in a single project-level directory: `src/constants/` or the equivalent framework location (e.g. `packages/shared-constants` in this monorepo).
- Once a global enum exists, feature code must `import` it — never redeclare locally.
- If the backend ships its own enum via `@bake-mall/contracts` (preferred), the feature only `import` it; do not add a parallel local copy.

## API contract

- All HTTP traffic flows through the project's **global** `ApiClient`. Per-feature `api/index.ts` only composes calls.
- The global `ApiClient` handles:
  - Base URL, headers, auth tokens.
  - Generic error envelopes (`ApiError` shape) and 401 → logout flow.
  - Network retries and timeouts.
- Per-feature `api/index.ts` **must not** perform payload reshaping, status-code branching, or DTO mapping. Those belong in `hooks/` so the same composition can be reused by tests.

## Required deliverables when this skill runs

1. Create every folder listed above, even if some are empty.
2. Wire `index.ts` exports for routing/registration.
3. Mirror backend DTOs into `type/` (do not import child-component props).
4. Provide at least one mock fixture so the view renders end-to-end without the backend.
5. Verify with `pnpm --filter <package> typecheck`, `test`, `lint` and production `build` before declaring complete.
6. For browser/WebView code, report the runtime baseline and run the `frontend-runtime-compat` checklist; build success alone is insufficient.
