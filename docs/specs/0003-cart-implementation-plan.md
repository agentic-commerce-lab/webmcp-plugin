# Cart architecture — implementation record

Date: 2026-07-19
Status: **Implemented** on `refactor/typescript-foundation` (not yet merged to `main`)
Implements: [ADR 0004 — Cart architecture](../adr/0004-cart-architecture.md)

**Workflow:** one branch; each commit below is self-contained and reviews in
isolation (each extractable as its own MR), and leaves `check` + `lint` + `format` +
`build` + e2e green.

## End state (per ADR 0004) — delivered

- Cart writes execute **server-side via `CartService`** through storefront-scoped,
  same-origin, `private, no-store`, `XmlHttpRequest`-restricted endpoints → same
  context as the shopper, uncached, **no token in the browser** (D3). ✅
- Two product-keyed write tools: `add_to_cart(product, quantity=1)` (relative) and
  `update_line_item(product, quantity)` (target; `0` = remove); `remove_from_cart`
  dropped (D1/D2). ✅
- The cart is **projected in the frontend** (`runtime/domain/cart.ts`,
  `normalizeCart`), next to `product.ts` / `category.ts`; the controller returns the
  **raw** `CartResponse` and there is no `CartPayloadBuilder` (D4). ✅
- `cart-ui-sync` slimmed to a native cart-widget refresh, no client-side deltas (D5). ✅
- Tool discovery: the `.wmcp` document is removed (D6 → [ADR 0006](../adr/0006-tool-discovery-contract.md)). ✅

## Commits (as shipped)

| # | Commit | What landed |
| --- | --- | --- |
| C1 | `0816fc2` | PHP: `POST` (add, relative) + `PATCH` (target, `0` = remove) `/webmcp/cart/line-item`; storefront-scoped, `XmlHttpRequest`, resolve `$context->getToken()`, `CartService` in-process (`add` / `changeQuantity`), `Cache-Control: private, no-store`. |
| C2 | `a7d9d48` | TS: cart writes call the new endpoints; `add_to_cart` / `update_line_item` re-keyed off product (id/sku/url); `update_line_item` = target quantity incl. `0` = remove. Removed the storefront cart transport, cart CSRF discovery, `findStorefrontCartLineItem`, and the `remove_from_cart` tool + its config. Cart projected in `domain/cart.ts`; controller returns the raw `CartResponse`. |
| C3 | `d353a07` | Slimmed `cart-ui-sync`: dropped the client-side delta computation; native cart-widget/offcanvas refresh from the authoritative response; kept the optional `showCartOverlay`. |
| C4 | `fc6267d` | Interim: auto-derived the WebMCP document from the tool registry — **superseded by C6.** |
| C5 | `6d52b09` | `get_sales_channel_context` read tool (`readOnlyHint: true`) reusing C1's server-side context-resolution primitive. |
| C6 | `b2cd66d` | Removed the bespoke `.wmcp` document entirely; `document.modelContext` is the single discovery contract ([ADR 0006](../adr/0006-tool-discovery-contract.md)). |

## Verification (as run)

- **e2e:** the 11-test Playwright suite (`bun run test:e2e`) drives the full cart
  lifecycle product-keyed against a real shop — add, target-quantity update, the
  idempotent `quantity: 0` no-op/remove, `get_sales_channel_context`, the tool
  surface, and `showCartOverlay` — all green.
- **Static:** `bun run check` + `lint` + `format:check` + `build` green; `composer qa`
  (`php -l` + PHPStan level 8 + PHP-CS-Fixer) green.

## Residual / not covered here

- **Projection parity** for the richest carts (variant with options, promotion/
  voucher, rule-inserted free gift, bundle/nested line item) is not yet an explicit
  field-by-field e2e assertion — recommended before merge to `main`.
- **Token rotation** (add → login → read keeps one cart) and **promotion/gift-line
  isolation** are handled by construction but not yet pinned by a dedicated e2e.
- Out of scope: W3C declarative form API (spec still a TODO); any cross-origin agent
  scenario.
