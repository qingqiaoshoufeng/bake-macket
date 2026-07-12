# Task 6 Report

Implemented the Bake Mall customer-support API domain: administrator Banner CRUD and public Banner discovery, authenticated customer profile, cart, and address-book endpoints.

- Banner targets validate against existing product/category records; `NONE` requires a null target. Public banners are enabled-only and omit entries whose product/category target is no longer public.
- Customer profile responses expose only avatar, nickname, and a masked phone number.
- Address create, update, and explicit default selection use TypeORM transactions to clear other defaults before storing the selected default; the test covers two default creates leaving only the second default.
- Cart insertions use the existing `(user_id, sku_id)` unique key and MySQL `ON DUPLICATE KEY UPDATE` to merge concurrent additions while capping at 99. Cart reads expose live SKU/product data and `available`; they make no order-availability guarantee.
- Corrected Task 3 entity metadata to match the locked migration's snake_case columns for banner, address, cart, and user records. No schema migration was required.
- Added customer-domain e2e coverage for address-default uniqueness, cart quantity merge, and public Banner filtering.

Runtime verification passed against branch-local MySQL: a real API process accepted admin/customer requests; customer phone output was masked, two default-address creates retained only the second default, concurrent adds of quantities 1 and 2 yielded one cart item at quantity 3, invalid `NONE` Banner targets returned 400, and a Banner vanished from the public list after its target product was disabled.

Verification passed with Node 22.23.1:

- `pnpm --filter @bake-mall/api test:e2e -- customer.e2e-spec.ts`
- `pnpm --filter @bake-mall/api test`
- `pnpm --filter @bake-mall/api lint`
- `pnpm --filter @bake-mall/api typecheck`
- `pnpm --filter @bake-mall/api build`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
