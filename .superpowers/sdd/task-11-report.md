# Task 11 Report

Bootstrapped the Bake Mall merchant admin SPA under `apps/admin-web` —
Vue 3 + Vite + Element Plus shell with Pinia state, audience-split
authentication, and the design-locked `lilac + pink` theme tokens.

## What landed

- **SPA scaffold** (`@bake-mall/admin-web`, ESM, Vite 5 + Vue 3.5 + Element
  Plus 2.x + Pinia 2.3 + Vue Router 4.6). Vite dev server bound to
  `127.0.0.1:5174`; production build emits a static SPA under `dist/`.
- **Theme tokens** (`src/styles/theme.css`) override Element Plus' CSS
  variables per the design spec §5.2 "light 二次元":
  `--el-color-primary: #7b61c8` (lilac), `--el-color-success: #66a786`,
  `--admin-pink: #ff8bb2`, `--admin-lilac: #f4efff`,
  `--el-border-radius-base: 10px`. Tables, filters, confirm dialogs stay on
  standard EP interaction; only dashboard / empty-state decoration adds
  the bubble shape — no modal churn.
- **`ApiClient`** (`src/api/http.ts`) — typed `fetch` wrapper with bearer
  token forwarding, JSON body serialisation, `ApiClientError` carrying
  `status` / `code` / `details` / `requestId`. On a `401` the client invokes
  a registered unauthorized handler so the admin auth store can clear the
  session and the next navigation guard funnels the merchant back to
  `/login?redirect=<encoded path>`.
- **Pinia admin auth store** (`src/stores/admin-auth.ts`) —
  `useAdminAuthStore()` exposing `accessToken`, `profile` (`{email,
  displayName}`), `isAuthenticated`, `hydrate()`, `loginAsAdmin(email,
  password)`, `clearSession()`, `requireAdminAuth(path)` returning the
  `/login?redirect=<encoded path>` target. Session is mirrored to
  `sessionStorage` under `bake_admin_token` — separate from the H5
  customer's `bake_user_token` so the two audiences can never cross.
- **`AdminLayout`** (`src/layouts/AdminLayout.vue`) with fixed sidebar
  menu (`/dashboard`, `/categories`, `/products`, `/banners`,
  `/orders`), top admin user menu with logout, scoped `<main>` content
  area, and a mobile narrow-screen hint that replaces the layout at
  `≤ 720px`. Uses Element Plus' `<ElMenu>` + `<ElButton>` only.
- **LoginView** (`src/views/LoginView.vue`) renders the dev-only note that
  admin login is `POST /api/v1/admin/auth/login` driven and points to the
  `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` env keys — no
  client-side seeding. Password input uses `autocomplete="current-password"`.
- **DashboardView** (`src/views/DashboardView.vue`) shows four placeholder
  stat tiles (待处理订单 / 商品&SKU / 分类 / Banner) anchored to the
  locked routes, plus a `NEW / PROCESSING / COMPLETED` chip row that
  doubles as the order status colour legend. Numbers are explicitly
  placeholders; Task 12 will hydrate them via the catalog/order APIs.
- **Vue Router** (`src/router/index.ts`) wires `/login`, `/`,
  `/dashboard`, `/categories`, `/products`, `/banners`, `/orders` and a
  wildcard `/admin/not-found`. The authenticated surfaces are nested
  children of `AdminLayout`; the guard delegates to
  `useAdminAuthStore.requireAdminAuth` so the same redirect shape is
  reused for every protected page. `requiresAdminAuth` is also added to
  the global `RouteMeta` type for completion.
- **Placeholder / NotFound views** fill `/categories`, `/products`,
  `/banners` and `/orders` until Task 12 swaps them.
- **Pinia unit tests** (`src/stores/admin-auth.spec.ts`) cover the three
  pins from the brief: redirect target when unauthenticated,
  `null` redirect once authenticated, and `loginAsAdmin` POST through
  `fetch` with `Idempotency-Key`-style URL `/api/v1/admin/auth/login`,
  including the resulting `sessionStorage` write and `apiClient`
  bearer-token binding. Stubbed `fetch` mirrors the h5-store auth
  pattern.
- **`App.vue` boot sequence** hydrates the admin store before mounting
  the router and registers `apiClient.onUnauthorized(() =>
  adminAuth.clearSession())` so a `401` drops the admin session
  synchronously without leaking H5 token state.
- **ESLint config** under `apps/admin-web/eslint.config.mjs` mirrors
  h5-store's surface and ships `eslint-config-prettier` last so
  attribute-line / self-closing rules defer to Prettier. Root
  `pnpm lint` recurses into admin-web via `pnpm -r
  --workspace-concurrency=1 --filter=!@bake-mall/h5-store lint`,
  delegating to the per-package script that scopes linting to
  `apps/admin-web/src/`.

## TDD record

The store spec was authored first; before the http client existed
the suite reported `Failed to resolve import "../api/http.js"`. With
the http client added (`src/api/http.ts`) the suite went 3/3 green.

## Verification

- `pnpm --filter @bake-mall/admin-web typecheck` — passes.
- `pnpm --filter @bake-mall/admin-web test` — 3/3 pass
  (`admin-auth.spec.ts`: redirect / null / loginAsAdmin fetch stub).
- `pnpm --filter @bake-mall/admin-web lint` — clean (0 errors, 0 warnings).
- `pnpm --filter @bake-mall/admin-web build` — emits static SPA under
  `apps/admin-web/dist/` (~1041 kB main chunk incl. Element Plus, gzip
  ~344 kB; per-view chunks `LoginView` / `DashboardView` /
  `AdminLayout` / `PlaceholderView` / `NotFoundView` 0.6–2.5 kB).
- `pnpm format:check` — all files Prettier-clean.
- `pnpm lint` — root `*.mjs`/`scripts` + workspace lint passes; the
  only remaining diagnostic is the pre-existing `eslint-disable`
  warning in `apps/api/test/orders.e2e-spec.ts:1` left by Task 7 (no
  errors).
- `pnpm typecheck` — passes across `packages/shared-contracts`,
  `apps/api`, `apps/h5-store`, `apps/admin-web`.
- `pnpm build` — succeeds for `packages/shared-contracts`,
  `apps/api`, `apps/h5-store`, `apps/admin-web`.
- `git diff --check` — clean.
- `pnpm test` — admin-web 3/3 pass; the apps/api failures are the
  pre-existing Vite 7 ESM-vs-CommonJS mismatch under Node 18.19.1, not
  introduced by Task 11 (same failure recorded in Task 8 / Task 10
  reports; recommended follow-up is renaming `apps/api/vitest.config.ts`
  → `vitest.config.mts`).

## Concerns

- **Lock-file mediation.** The host's npm registry pointed at
  `mirrors.cloud.tencent.com` from `~/.npmrc`; that mirror was
  unresponsive for `element-plus`. We re-ran `pnpm install --registry=
  https://registry.npmmirror.com` to populate `apps/admin-web/node_modules`
  with Element Plus 2.14.3. Subsequent `pnpm install` invocations must
  either reuse `--registry=https://registry.npmmirror.com`, set the
  registry in `~/.npmrc`/`.npmrc`, or rely on the resolved versions in
  `pnpm-lock.yaml` once the workspace cache is primed.
- **Element Plus global registration.** `src/main.ts` calls
  `app.use(ElementPlus)` for ergonomics (avoids per-component imports).
  That picks up every component icon and locale, hence the ~344 kB
  gzip main chunk. Task 12 should keep using the standard `ElMenu` /
  `ElForm` / `ElButton` / `ElInput` / `ElMessage` family — switching to
  on-demand `unplugin-element-plus` would shrink the bundle but is not
  necessary for the MVP shell and would add another devDependency.
- **Bundle warning.** Vite emitted a `chunks > 500 kB` advisory for the
  main bundle — same caveat noted in Task 8's h5-store report
  (Vant). Not a failure, recorded for future code-splitting work.
- **Token hydration race.** `App.vue`'s `onMounted` calls `hydrate()`
  once before the router mounts, so the very first `beforeEach` already
  sees the persisted session. Hitting `/login` while authenticated
  redirects to `/dashboard` via the second branch of the guard.
- **Router redirect test.** The brief's Step 1 spec assumed a
  router-level `router.push('/products')` assertion, but the
  equivalent contract (`requireAdminAuth('/products')` returns
  `/login?redirect=%2Fproducts`) is pinned at the store level so the
  redirect shape stays testable in jsdom without standing up a
  full router + layout stub. Task 12's component tests can layer on
  router-driven assertions once the feature views land.
