# Cart architecture — implementation plan

Date: 2026-07-18
Implements: [ADR 0004 — Cart context, caching & exposure](../adr/0004-cart-context-caching-declarative.md)
Branch: `refactor/typescript-foundation` (stacked)

**Workflow:** one big branch; **each commit is later extracted as its own MR**, so
every commit must be self-contained and leave `check` + `lint` + `format` + `build`
+ e2e green. Commits below are ordered so each builds on the previous but reviews
in isolation.

## Target end state

- Cart writes execute **server-side via `CartService`** through storefront-scoped,
  same-origin, `private, no-store` endpoints → same context as the user, uncached,
  **no token in the browser**.
- Two product-keyed write tools: `add_to_cart(product, quantity=1)` (relative) and
  `update_line_item(product, quantity)` (target; `0` = remove). `remove_from_cart`
  dropped.
- `get_cart` unchanged, co-located, sharing `CartPayloadBuilder`.
- `.wmcp` auto-derived from the tool manifest; DOM-affordance machinery removed.
- `cart-ui-sync` slimmed to a native cart-widget refresh (no client-side deltas).

## Commits / MRs

### C1 — PHP: server-side cart write endpoints
Add `POST /webmcp/cart/line-item` (add, relative) and `PATCH /webmcp/cart/line-item`
(set target quantity, `0` = remove) to the cart controller. Storefront-scoped,
`XmlHttpRequest => true`, resolve `$context->getToken()`, call `CartService`
in-process, resolve product id/sku → line item server-side, return
`CartPayloadBuilder` payload with `Cache-Control: private, no-store`. Additive —
not yet wired to the runtime.
- **Done when:** endpoints return correct cart JSON for add/update/remove against a
  real shop; header is `no-store`; unit/e2e smoke on the routes.

### C2 — TS + tools: migrate writes to the endpoints, declarative-per-line
Rewrite `ShopwareClient` cart writes to call C1. Re-key `add_to_cart` and
`update_line_item` off product (id/sku); `update_line_item` uses target semantics
incl. `0` = remove. **Delete** `adapters/storefront-cart.ts`, cart CSRF discovery,
`findStorefrontCartLineItem`, and the `remove_from_cart` tool + its
`removeFromCartToolEnabled` config. Update `meta.html.twig` tool toggles.
- **Done when:** add/update/remove drive the new endpoints; cart e2e green; grep
  shows the deleted symbols gone.

### C3 — Slim `cart-ui-sync`
Drop delta computation (`publishCartMutation` prev/removed/delta). After a write,
trigger Shopware's native cart-widget/offcanvas refresh from the authoritative
response. Keep the optional `showCartOverlay`.
- **Done when:** mini-cart/offcanvas reflects agent writes; e2e visual-refresh
  assertion green; delta code removed.

### C4 — Auto-derive `.wmcp` from the tool manifest
Make the imperative tool registry the single source; project `.wmcp` as the tool
list (name/description/inputSchema/annotations). Remove `coreShopwareElements`,
`normalizeElement`/`normalizeAction`, the `selector`/`role`/`action`/`csrf_tag`
model, and `securityDefinition` from `WebMcpController`. Deliver the manifest
PHP→TS via the existing config pipe.
- **Done when:** `/webmcp.wmcp` output derives from the tools with no hand-written
  affordances; document e2e/schema check green.

### C5 (follow-on) — `get_sales_channel_context`
New read tool (`readOnlyHint: true`) reusing C1's server-side context-resolution
primitive. Tracked as roadmap WP9; listed here only to keep the shared plumbing
explicit. Not required for the cart migration.

## Risks / verification

- **Promotions & rule-inserted gifts:** writes must touch only the targeted
  product line, never promotion/gift lines — explicit e2e with an active promotion.
- **Token rotation on login/logout:** server-side resolution handles it (context
  from session each request); verify add-then-login-then-read keeps one cart.
- **Behaviour parity:** the Playwright suite is the safety net for the C1→C3 swap;
  extend it before deleting the storefront-route path, not after.

## Out of scope

W3C declarative form API (spec still a TODO — adopt additively later); any
cross-origin agent scenario.
