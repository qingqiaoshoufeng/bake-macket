# Task 8 Report

Implemented the Bake Mall customer-facing mobile storefront shell under
`apps/h5-store` — Vue 3 + Vite + Vant 4 SPA with Pinia state, Vue Router
guards, the shared API HTTP client, and the miniapp bridge shim.

## What landed

- **SPA scaffold** (`@bake-mall/h5-store`, ESM, Vite 5 + Vue 3.5 + Vant 4.10
  + Pinia 2.3 + Vue Router 4.6) with Vite/Vue/Tailwind-free "fresh" theme
  tokens (`--mall-cream`, `--mall-leaf`, `--mall-apricot`, `--van-primary-color`,
  `--van-radius-lg`). Light-only by design; no dark mode is wired in.
- **Router** with the locked route set
  (`/`, `/category/:id`, `/products/:id`, `/cart`, `/checkout`, `/orders`,
  `/orders/:id`, `/profile`, `/addresses`, `/login`, plus a wildcard
  `NotFoundView`). Two route-meta flags drive navigation guards:
  `requiresAuth` (orders/profile/addresses) and `requiresVerifiedPhone`
  (checkout). Routes for catalog/cart/checkout/orders/addresses/profile
  render a shared `PlaceholderView` until Tasks 9 / 10 wire their features.
- **`ApiClient`** (`src/api/http.ts`) — typed `fetch` wrapper with bearer
  token forwarding, JSON body serialisation, `ApiClientError` carrying
  `status` / `code` / `details` / `requestId`. On a `401` response the client
  invokes a registered unauthorized handler (registered from `App.vue`'s
  `onMounted` so the auth store drops the session before the next navigation
  guard fires).
- **Pinia auth store** (`src/stores/auth.ts`) — `useAuthStore()` exposing
  `accessToken`, `profile`, `isAuthenticated`, `hasVerifiedPhone`,
  `loginWithDevelopmentCode(phone, code)`, `requireVerifiedPhone(path)`
  returning the `/login?redirect=<encoded>` target when verification is
  missing. Session is mirrored to `localStorage` and re-bound to the
  `ApiClient` bearer token on every change.
- **Miniapp bridge shim** (`src/bridge/miniapp.ts`) —
  `installMiniappBridge(onMessage)` filters `window.message` events for
  `source === 'bake-miniapp'` and dispatches `WECHAT_CODE` /
  `PHONE_CREDENTIAL` payloads. The `LoginView` listens for these events
  (and exposes a development-only "派发 WECHAT_CODE" button to exercise the
  handler without the native shell).
- **Login view** (`LoginView.vue`) renders the dev-only
  `13800000000 / 123456` prefilled shortcut (hidden in production via
  `import.meta.env.PROD`), posts to `/auth/dev/login`, and bounces back to
  the `redirect` query on success.
- **Pinia unit tests** (`src/stores/auth.spec.ts`) — three vitest specs in a
  `jsdom` environment: redirect target when phone missing, `null` when
  verified, dev-login round-trip including JSON body shape and bearer token
  forwarding. TDD: written first; ran red; implemented; ran green.
- **ESLint config** under `apps/h5-store/eslint.config.mjs` with
  `eslint-config-prettier` to defer attribute-line / self-closing rules to
  Prettier. Root `pnpm lint` no longer recurses into `apps/h5-store`
  (`--filter=!@bake-mall/h5-store`) per the brief's ownership rule; the
  storefront ships its own `pnpm --filter @bake-mall/h5-store lint`.

## Verification

- `pnpm --filter @bake-mall/h5-store typecheck` — passes.
- `pnpm --filter @bake-mall/h5-store test` — 3/3 pass.
- `pnpm --filter @bake-mall/h5-store lint` — clean (0 errors, 0 warnings).
- `pnpm --filter @bake-mall/h5-store build` — emits static SPA under
  `apps/h5-store/dist/` (315 modules, gzip index 43.5 kB).
- `pnpm format:check` — all files Prettier-clean.
- `pnpm lint` — root `*.mjs`/`scripts` + workspace lint excluding h5-store
  (per brief) passes; the only remaining diagnostic is a pre-existing
  `eslint-disable` warning in `apps/api/test/orders.e2e-spec.ts:1` left by
  Task 7 (no errors).
- `pnpm typecheck` — passes across `packages/shared-contracts`,
  `apps/api`, `apps/h5-store`.
- `pnpm build` — succeeds for `apps/api` and `apps/h5-store`.
- `git diff --check` — clean.

## Concerns

- **`pnpm test` fails on `apps/api`** under the current shell (Node 18.19.1
  vs. Vite 7's `engines: ^20.19.0 || >=22.12.0`). Vitest 3.2.7's
  `dist/config.cjs` calls `require('vite/dist/node/index.js')`, which is
  ESM-only in Vite 7 — the call throws `ERR_REQUIRE_ESM`. The failure is
  reproducible on `HEAD~1` (no Task 8 changes) and is not introduced by
  this task. The Task 7 report was generated on Node 22, where the
  resolved Vite 7 load succeeds. Recommended follow-up outside Task 8:
  rename `apps/api/vitest.config.ts` to `vitest.config.mts` (and bump
  the `scripts.test` / `scripts.test:e2e` entries) so Node loads it as
  ESM and Vitest can dynamic-import Vite 7.
- **Lock file changes are limited** to the new h5-store dependencies
  (Vue, Vant, Pinia, Vue Router, jsdom, vue-tsc, vite plugin-vue) plus
  `eslint-config-prettier` at the root and in h5-store's devDependencies.
  No shared dependency was upgraded.
- **TDD discipline** — the brief's failing test was authored first; the
  suite went red, then green after the auth store + HTTP client were
  implemented.
- The `PlaceholderView` is intentionally permissive: it accepts any route
  name and prints it. Task 9 / Task 10 replace each `PlaceholderView`
  binding with the actual feature view; the router surface itself does not
  need to change.