# Cart architecture — implementation record

Date: 2026-07-21
Status: **Implemented** on `refactor/typescript-foundation` (not yet merged to `main`)
Implements: [ADR 0004 — Cart architecture](../adr/0004-cart-architecture.md)

The record of how [ADR 0004](../adr/0004-cart-architecture.md) is implemented.

## What ships

- **Cart over session-based storefront routes** (D3). The cart tools ride the shopper's
  storefront **session cookie** — no context token, no access key, no custom route
  (`transport/storefront-cart.ts`):
  - `get_cart` → `GET /checkout/cart.json` (returns the same `CartResponse` as the Store
    API cart route, but storefront-scoped / session-based).
  - `add_to_cart(pid, qty)` → `POST /checkout/line-item/add` (form-encoded `lineItems`;
    additive — Shopware sums quantity for an existing product line).
  - `update_line_item(pid, N)` → reads `cart.json`, then `POST /checkout/line-item/change-quantity/{pid}`
    (N>0) / `POST /checkout/line-item/delete/{pid}` (0) / no-op when removing an absent
    product. After each write the runtime re-reads `cart.json` for the authoritative state.
- **Two product-keyed write tools** (D1/D2): `add_to_cart(product, quantity=1)` (relative)
  and `update_line_item(product, quantity)` (target; `0` = remove). Line-item id = product
  id, so tools stay product-addressable.
- **Product/category reads stay on the Store API** with the public sales-channel access
  key (`transport/store-api.ts`, anonymous context). The access key is public/cache-safe.
- **Frontend projection** (D4): `runtime/domain/cart.ts` (`normalizeCart`) projects the raw
  `CartResponse` into the compact `CartSummary`. Transport-independent — `cart.json` returns
  the same shape as the Store API cart route.
- **Slim native cart-UI refresh** (D5): `cart-ui-sync.ts` refreshes the cart
  widget/offcanvas from the authoritative `cart.json` state; optional `showCartOverlay`.
- **PHP surface**: `WebMcpController` is one uncached storefront read —
  `/webmcp/sales-channel-context`. No cart routes, no context-token route.

## Why not the Store API for the cart

The Store API resolves the context token from the request header only, so operating the
shopper's session cart over it would require exposing the per-user token to JS (XSS blast
radius, a custom bootstrap route, a headless/PWA pattern in the Twig storefront). A
token-bootstrap variant was briefly implemented and then withdrawn. The session-based
storefront routes achieve the same shared cart with zero token exposure — see
[ADR 0004 → Rejected alternatives](../adr/0004-cart-architecture.md#rejected-alternatives).

## Verification (as run)

- **Static:** `bun run check` + `lint` + `format:check` + `build` green; `composer qa`
  (`php -l` + PHPStan level 8 + PHP-CS-Fixer + PHPUnit) green.
- **e2e (Playwright):** the tool surface driven against a real shop — product search/detail,
  category tree, full cart lifecycle (add → read → target-update → `0`-remove), additive
  add, multi-line cart projection, the idempotent `quantity: 0` no-op, `showCartOverlay`,
  `get_sales_channel_context`, navigate.
- **Cart operates the shopper session cart:** a WebMCP tool add is read back straight from
  Shopware's own `/checkout/cart.json` (bypassing the tools) — proving the tool wrote to the
  shopper's session cart, using only the session cookie.
- **Cross-login coherence:** guest add → login → items persist; shopper storefront-add +
  agent tool-add share one guest cart across login; logged-in coherence. (Trivial by
  construction — both sides ride the same session.)

## Not covered here

- **Projection parity** for the richest carts (variant with options, promotion/voucher,
  rule-inserted free gift, bundle) beyond a multi-line assertion — needs seeded demo data.
- **Promotion/gift-line isolation** is handled by construction (writes touch only the
  targeted line) but not pinned by a dedicated e2e.
- Out of scope: W3C declarative form API (spec still a TODO); any cross-origin agent
  scenario (the cart needs the same-origin session cookie).
