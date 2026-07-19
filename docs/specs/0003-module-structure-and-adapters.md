# Spec — Module structure: adapter, transport, domain

Date: 2026-07-18
Status: Draft
Relates to: [Architecture Overview](../Architecture.md) ·
[ADR 0003 — TypeScript architecture](../adr/0003-typescript-architecture.md) ·
[Improvements & Roadmap](0001-improvements-and-roadmap.md) (A2)

## Goal

Give the storefront runtime a small, explicit layering so `shopware-client.ts`
(596 lines) and `model-context-registry.ts` (396 lines) stop being catch-alls, and
so a contributor can tell — from the folder — where a piece of code belongs.

No behavior change, no tool-contract change. Internal refactor only.

## The layering rule (what goes where)

Three layers, one-way dependencies (`tools → adapter → transport/domain`):

| Layer | Answers | Knows about | Must NOT |
| --- | --- | --- | --- |
| **transport/** | "how to make the HTTP call" | fetch, headers, CSRF/token, endpoint paths, response parsing | know what a product or cart *means*; hold session state |
| **domain/** | "what the data means" | raw payload shapes → typed models (`ProductSummary`, `CartSummary`, category nodes) | do any I/O / touch the DOM |
| **adapter** (`shopware-client.ts`) | "do a commerce operation" | which backend per op, session/context, combining transport + domain | build JSON schemas or format agent text (that's `tools/`) |

Everything else already has a home: `tools/` = MCP contract, `model-context/` = MCP
registry/native bridge, `cart-ui-sync.ts` = browser side effects, `runtime.ts` =
bootstrap/config/document.

**Why one adapter, not two classes:** the Store-API reads and the cart writes share
`baseUrl`, `contextToken`, and `resolveProductId`. Splitting `ShopwareClient` into two
classes would just thread that shared state around. So the *backends* are separated in
`transport/` (as function modules), while `ShopwareClient` stays a single facade that
holds the context and orchestrates.

## Where `shopware-client.ts` decomposes today

The 596 lines are three blocks stacked in one class:

| Block | Methods | ~lines | Target |
| --- | --- | --- | --- |
| Store-API reads | `searchProducts`, `findProductBySku`, `getProduct`, `getNavigationCategories`, `getProductCategories`, `resolveProductId`, `storeApiRequest` | ~175 | facade keeps the read ops; `storeApiRequest` → `transport/` |
| Cart orchestration | `getCart`, `addProductToCart`, `removeProductFromCart`, `updateLineItem` | ~85 | **stays in the facade** (this is the adapter's core) |
| Storefront cart transport | `webMcpCartRequest`, `findStorefrontCartLineItem`, `storefrontAddProductToCart`, `storefrontChangeLineItemQuantity`, `storefrontRemoveLineItemFromCart` | ~255 | → `transport/storefront-cart.ts` (after de-duping) |

The 255-line write-transport block is both the duplication hotspot and the extraction
target.

## Target folder hierarchy

```
webmcp-model-context/
  runtime.ts                 entry: bootstrap, config, WebMCP document, tool registration
  types.ts  globals.d.ts

  tools/                     MCP contract — the "what" for the agent
    define-tool.ts  schemas.ts  storefront-tool.utils.ts  *.tool.ts

  model-context/             MCP plumbing (moved from the two loose runtime/*.ts files)
    registry.ts              getModelContext, register/unregister, upsertTool, events
    native-bridge.ts         native document.modelContext integration (self-contained)

  shopware-client.ts         the adapter/facade: session context + commerce orchestration

  transport/                 raw HTTP mechanics — no commerce meaning
    http.ts                  response parsing + error messages
    paths.ts                 endpoint path constants
    token-discovery.ts       csrf / context-token / access-key readers
    store-api.ts             storeApiRequest()  (moved out of the client)
    storefront-cart.ts       cart form-POST helper + the 3 write ops + line-item lookup

  domain/                    payload → typed models
    product.ts  category.ts  cart.ts

  cart-ui-sync.ts            best-effort storefront UI refresh after mutations
```

Only two new files vs. today (`transport/store-api.ts`, `transport/storefront-cart.ts`)
plus a `model-context/` folder. The `model-context/` grouping and any file renames are
**optional polish** — see step 4.

## Refactor steps (each = one commit, e2e-verified)

### Step 1 — De-duplicate the storefront write transport (highest value, no new file)
`storefrontAddProductToCart` / `…ChangeLineItemQuantity` / `…RemoveLineItemFromCart`
share an identical ~18-line transport core (headers, CSRF apply, `fetch`,
`parseFlexibleResponse`, `!response.ok` check). Extract one private helper:

```ts
private async storefrontCartPost(url: URL, body: URLSearchParams): Promise<unknown>
```

Keep **per-method**: the URL, the body, the `publishCartMutation` detail, and the
payload-or-fallback return shape (these genuinely differ — do NOT fold them in).
Realistic saving ≈ 50–70 lines (not the ~130 a naive "they're identical" read suggests).

### Step 2 — Extract the native bridge from the registry
`model-context-registry.ts` (396) → move the self-contained native chunk to
`native-bridge.ts` (~160 lines): `getNativeModelContext`, `createNativeModelContextTool`,
`tryRegisterNativeModelContextTool` (the 4-signature retry), `normalizeNativeToolInput`,
`serializeNativeToolResult`, `getNativeToolRegistry`, and its private `removeEmptyValues`.
Registry keeps the public API + helper-wrapping and imports the bridge. One-way dep:
`registry → native-bridge → (nothing)`. Leave the helper/visibility functions in the
registry (splitting those too yields 3 small files for little gain).

### Step 3 — Move the storefront write transport to `transport/`
Move Step-1's helper + the three `storefront*` write ops + `findStorefrontCartLineItem`
into `transport/storefront-cart.ts` as plain functions taking `{ baseUrl }` (they need
no other client state — unlike `storeApiRequest`, they do not mutate `contextToken`).
Also move `storeApiRequest` → `transport/store-api.ts`. The facade’s cart methods become
pure orchestration: resolve line item → decide change-vs-remove → call transport →
normalize via `domain/`. Result: `shopware-client.ts` ≈ 280 lines.

### Step 4 (optional polish) — folder tidy
Move `model-context-registry.ts` + `native-bridge.ts` into `model-context/`. Pure
renames/import updates, no logic. Skip unless the flatter layout starts to read poorly.

## Non-goals
- No split of `ShopwareClient` into two classes.
- No change to tool names, `inputSchema`, `structuredContent`, endpoints, or globals.
- No runtime-parse validation added here (that is the separate domain-types follow-up).

## Verification (after every step)
`bun run check` + `bun run lint` + `bun run format:check` + `bun run build`, and the
Playwright suite (`bun run test:e2e`, 10 tests) green. Because these are verbatim moves
+ one extracted helper, tsc-green + e2e-green ≈ behavior preserved.

## Recommended order & scope
Do **Step 1** and **Step 2** now (real wins, small diffs). **Step 3** next if we want the
full transport layering. **Step 4** only as cosmetic cleanup.
