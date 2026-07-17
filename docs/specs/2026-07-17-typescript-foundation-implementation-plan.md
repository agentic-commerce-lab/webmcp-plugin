# Implementation Plan: TypeScript Foundation & Feature Roadmap

Date: 2026-07-17
Status: Draft
Basis: [ADR 0004 — TypeScript integration & conventions](../adr/2026-07-17-typescript-architecture.md) ·
[Improvements & Roadmap](2026-07-17-improvements-and-roadmap.md) ·
[ADR 0002 — Categories via Store API](../adr/2026-07-17-categories-store-api.md)

## How to execute this plan

- **Base branch:** `refactor/typescript-foundation`, stacked on
  `add-e2e-integration-tests` with the three open PR branches
  (`fix/tool-input-schema-oneof`, `feat/categories-store-api`,
  `docs/architecture-and-roadmap`) merged in, so the base is the **complete
  current codebase** and the e2e CI (integration test on `pull_request`) runs.
- **Work in order.** Each work package (WP) is one commit (or a small stacked PR
  against the base). Do not reorder unless a dependency note allows it.
- **Definition of done per WP:** `bun run check`, `bun run lint`,
  `bun run format:check`, `bun run build` all green; where a WP changes runtime
  behavior, the Playwright e2e (`bun run test:e2e`) stays green; commit with the
  exact message given; never put agent/tool names in commits (see the
  preparing-merge-requests conventions).
- **When the 4 base PRs merge to `main`** (Monday review), rebase
  `refactor/typescript-foundation` onto `main` and re-target its PR.
- **Golden rule:** every WP keeps the plugin installable and the tool contract
  (`structuredContent` shapes, tool names, browser globals) stable unless the WP
  explicitly changes it. No behavior change hidden inside a "refactor" WP.

## Conventions introduced by this plan

- **zod** is the single source of truth for tool input: one `z.object(...)` per
  tool yields (a) the runtime validator and (b) the JSON Schema (via
  `zod-to-json-schema`). zod `.refine()` for "exactly one of id/sku/url" is
  runtime-only and does **not** emit a top-level `oneOf`, so the schema stays
  function-calling-API compatible by construction.
- **Domain types**: `any`/`UnknownRecord` is allowed only in the fetch/parse layer.
  Store API and cart payloads are parsed into typed models at the client boundary.
- **Module layout** (target):
  ```
  webmcp-model-context/
    bootstrap.ts            entry orchestration
    tool-registry.ts        register/unregister + native bridge wiring
    native-bridge.ts        document.modelContext integration
    document.ts             WebMCP document builder (single source, see WP6)
    tools/
      define-tool.ts        shared factory
      schemas.ts            shared zod schemas (productSelector, quantity, …)
      *.tool.ts             thin: schema + execute
    transport/
      store-api-client.ts   POST /store-api/* (typed)
      cart-client.ts        storefront cart routes + /webmcp/cart
      token-discovery.ts    context token / csrf / access key readers
    domain/
      product.ts category.ts cart.ts   zod schemas + inferred types + normalizers
    cart-ui-sync.ts         best-effort storefront UI refresh
    types.ts globals.d.ts
  ```

---

# Phase 1 — TypeScript foundation & architecture

## WP1 — Lint, format & CI quality gate

**Goal:** enforce type-check + lint + format on every PR. Directly answers the
review feedback ("CI pipeline", "strange TS").

**Add dev deps** (`package.json`): `eslint`, `@eslint/js`, `typescript-eslint`,
`eslint-config-prettier`, `prettier`, `globals`. Keep Bun as the package manager;
regenerate `bun.lock`.

**Scripts** (`package.json`):
```json
"lint": "eslint .",
"lint:fix": "eslint . --fix",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

**Files:**
- `eslint.config.js` — flat config: `@eslint/js` recommended +
  `typescript-eslint` recommended-type-checked for `**/*.ts`, `eslint-config-prettier`
  last. `languageOptions.parserOptions.projectService: true`. `ignores`:
  `dist/`, `node_modules/`, `.tools/`, `playwright-report/`, `test-results/`,
  `src/Resources/app/storefront/dist/`.
- `.prettierrc.json` — match existing style: `{ "printWidth": 120, "tabWidth": 4,
  "singleQuote": true, "trailingComma": "all" }`.
- `.prettierignore` — same as eslint ignores + `*.md` optional (keep docs manual).
- Delete stray `package-lock.json` (Bun is canonical); confirm it is gitignored.

**CI** (`.github/workflows/build-plugin-zip.yml`): add a `quality` job that runs on
the existing `pull_request` trigger:
```yaml
  quality:
    name: TypeScript quality
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: "1.3.14" }
      - run: bun install --frozen-lockfile
      - run: bun run check
      - run: bun run lint
      - run: bun run format:check
```
Make `build-plugin-zip` depend on it: `needs: [test, quality]`.

**Execution note:** running `eslint`/`prettier --check` the first time will report
issues. Fix them in this WP: `bun run lint:fix` + `bun run format` for mechanical
fixes, then hand-fix remaining lint errors (prefer real fixes over disables; a
disable must carry a one-line reason). The WP is done only when all four checks are
green with **zero** disables added except justified ones.

**Verification:** `bun run check && bun run lint && bun run format:check && bun run build` green.

**Commit:** `Add ESLint, Prettier and a TypeScript quality CI job`

## WP2 — tsconfig split & hardening

**Goal:** stop mixing Node + browser environments; raise type strictness.

**Files:**
- `tsconfig.base.json` — shared `compilerOptions`: current strict set **plus**
  `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`. Remove `allowJs`/
  `checkJs` if WP3 lands first (no `.js` left); otherwise keep until then.
- `tsconfig.json` — storefront: `extends` base, `lib: ["dom","dom.iterable","esnext"]`,
  **no** `"types":["node"]`, `include` storefront `src`.
- `tsconfig.node.json` — `extends` base, `types: ["node"]` (+ `@types/bun` for the
  build script), `include` `bin/**/*.ts`.
- `package.json` `check`: `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit`.

**Execution note:** the new flags (esp. `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`) will surface real type errors — fix each properly
(guards, explicit `| undefined`, avoiding `x[0]` without a check). Do not relax the
flags to silence errors.

**Verification:** both `tsc` projects green; `bun run build` green.

**Commit:** `Split tsconfig into browser/node projects and tighten strictness`

## WP3 — TypeScript entrypoint (drop the JS shim)

**Goal:** remove the `main.js`/TS split; whole runtime is TS.

**Steps:**
- Rename `src/Resources/app/storefront/src/main.js` → `main.ts` (keep the same
  `PluginManager.register` + runtime import). Verify the Shopware Vite storefront
  build discovers `main.ts` (it is Vite/esbuild-based and compiles `.ts`; the core
  storefront is TS). Build the theme locally and confirm the plugin JS is emitted.
- Update `bin/build-storefront-dist.ts` entrypoint to `main.ts`.
- Drop `allowJs`/`checkJs` from tsconfig; remove `**/*.js` from `include`.

**Fallback:** if the Shopware build does **not** pick up `main.ts`, keep a minimal
`main.js` shim (`import './main';`) and document why. Record the outcome in ADR 0004.

**Verification:** `bun run build` green; theme compile in a real shop emits the
plugin JS; e2e green.

**Commit:** `Use a TypeScript storefront entrypoint`

## WP4 — Shared tool factory + zod schemas + safety hints

**Goal:** kill per-tool boilerplate, make schema and type one source, add the
read/write and untrusted-content metadata the WebMCP security guidance requires.

**Add dev/runtime deps:** `zod`, `zod-to-json-schema`.

**Files:**
- `tools/schemas.ts` — shared zod pieces: `productSelector` (`{ id?, sku?, url? }`
  with `.refine` "exactly one"), `quantity`, `MAX_*` constants in one place.
- `tools/define-tool.ts` — `defineTool({ name, title, description, input, annotations, execute })`:
  - `input`: a zod schema; the factory derives `inputSchema` via
    `zodToJsonSchema(input, { target: 'openApi3' })` and validates input with
    `input.parse()` inside a wrapper that returns recoverable errors.
  - `annotations`: `{ readOnlyHint?: boolean; untrustedContentHint?: boolean }`,
    emitted into the tool metadata (`readOnlyHint` for search/get/*; product/cart
    content tools set `untrustedContentHint`).
  - guarantees `{ content, structuredContent }` output shape.
- Refactor **all 7 tools** onto `defineTool` + shared schemas; delete the
  duplicated `normalizeInput`/`normalizeQuantity`/`MAX_*`/"exactly one of".
- Confirm generated `inputSchema` has **no** top-level `oneOf/anyOf/...` (zod
  `.refine` is runtime-only), preserving the WP `fix/tool-input-schema-oneof` result.

**Verification:** `tsc`+`lint`+`build` green; for each tool, `structuredContent`
keys unchanged (diff against current output); e2e green; a quick check that every
tool's `inputSchema.type === 'object'` with no top-level combinators.

**Commit:** `Introduce a shared tool factory with zod schemas and safety hints`

## WP5 — Split the `shopware-client.ts` god-module

**Goal:** one responsibility per file; readable for contributors.

**Steps (pure move + re-export, no behavior change):**
- `transport/store-api-client.ts` — `storeApiRequest`, product search/detail,
  `createProductCriteria`, navigation call.
- `transport/cart-client.ts` — storefront cart routes + `/webmcp/cart`, line-item
  lookup.
- `transport/token-discovery.ts` — context token / csrf / access key readers + persist.
- `cart-ui-sync.ts` — `publishCartMutation` + all widget/off-canvas/cart-page refresh.
- `domain/*.ts` — the `normalize*` functions (see WP7 for typing them).
- `ShopwareClient` becomes a thin facade composing the transports (keep the public
  method surface identical so tools don't change).

**Verification:** `tsc`+`lint`+`build`+e2e green; no runtime source file > ~300 lines;
public `ShopwareClient` API unchanged (grep tool call sites — no edits needed).

**Commit:** `Split ShopwareClient into transport, domain and UI-sync modules`

## WP6 — Split `runtime.ts` + single source of truth for the WebMCP document

**Goal:** separate bootstrap/registry/native-bridge; end the PHP↔TS document
duplication (roadmap A1).

**Steps:**
- Extract `bootstrap.ts`, `tool-registry.ts` (incl. the dead-code fix in
  `upsertTool`), `native-bridge.ts` from `runtime.ts`.
- **Document contract decision:** make **PHP `/webmcp.wmcp` authoritative**. The
  storefront runtime fetches the document from that endpoint instead of rebuilding
  it client-side; drop the duplicated `buildWebMcpDocument` element/security code
  from TS. Keep a typed model for the fetched document. (If a client-side offline
  document is still required, instead extract a shared JSON fixture and assert
  equality in a test — but prefer fetch.)
- Version string `0.2` defined once (server side).

**Verification:** `tsc`+`lint`+`build`+e2e green; `document.webMcp.getDocument()`
returns the same shape as before; `/webmcp.wmcp` unchanged.

**Commit:** `Make the PHP endpoint the single source of the WebMCP document`

## WP7 — Domain types (remove boundary `any`)

**Goal:** confine `any`/`UnknownRecord` to the parse layer.

**Steps:**
- In `domain/product.ts`, `domain/category.ts`, `domain/cart.ts`: zod schemas for
  the **subset** of the Store API / cart payloads actually consumed; `z.infer`
  types; `parse`/`safeParse` in the normalizers.
- Type `storeApiRequest<T>(path, body, schema): Promise<T>` — callers pass the
  expected schema; the boundary is the only place `any` appears.
- Reduce `UnknownRecord`/`any` counts (baseline: 83 `UnknownRecord`, 44 `any`) to
  near-zero outside `domain/*` parse functions and `globals.d.ts`.

**Verification:** `tsc` (with WP2 flags) + `lint` + `build` + e2e green; grep shows
`any` only in the parse layer.

**Commit:** `Add typed domain models for Store API and cart payloads`

## WP8 — Contributor ergonomics & housekeeping

**Files:**
- `CONTRIBUTING.md` — architecture map (the module layout above), the two build
  channels (source deploy vs ZIP), how to add a tool (via `defineTool`), how to run
  `check`/`lint`/`format`/`build`/`test:e2e`.
- Update `AGENTS.md` — remove the stale `src/Resources/public` vanilla-JS references
  (roadmap A8); point to the TS runtime layout.
- Align `Dockerfile` PHP to the composer platform (8.2) or bump composer to 8.3
  (pick one; document).
- Optional (roadmap A7): add **PHPStan** to `composer qa`.

**Verification:** links resolve; `composer qa` green.

**Commit:** `Document the architecture and align tooling versions`

---

# Phase 2 — Feature roadmap

All new tools are built with `defineTool` (WP4), typed via `domain/*` (WP7), carry
correct `readOnlyHint`/`untrustedContentHint`, get an admin toggle in `config.xml`,
a Twig toggle in `meta.html.twig`, a README tool-table row, and an e2e assertion.

## WP9 — `get_sales_channel_context` (MVP differentiator)
Read tool. Returns sales channel, language, currency, country, customer group (if
known), tax display mode, active domain, and the enabled WebMCP tool set. Source:
Store API `/store-api/context` + the runtime config already injected via Twig.
`readOnlyHint: true`. **Commit:** `Add get_sales_channel_context tool`

## WP10 — `get_checkout_requirements` (MVP Should)
Read-only checkout metadata: required address fields, countries/states, salutations,
available shipping/payment methods, tax display mode, currency, checkout URL. Source:
Store API (`/store-api/country`, `/store-api/salutation`,
`/store-api/shipping-method`, `/store-api/payment-method`, `/store-api/context`).
Must not place an order. `readOnlyHint: true`. **Commit:** `Add get_checkout_requirements tool`

## WP11 — `clear_cart` (ACL-129)
Remove all line items. Prefer a single Store API/storefront call; else iterate line
items. Returns the emptied cart. Not `readOnlyHint`. **Commit:** `Add clear_cart tool`

## WP12 — `create_checkout` / navigate-to-checkout (ACL-128)
Return/navigate to the checkout URL for the current cart (no order placement).
Coordinate with the page-navigation work (ACL-127) so navigation is one mechanism.
**Commit:** `Add create_checkout navigation tool`

## WP13 — page navigation tool (ACL-127)
Navigate the storefront on behalf of the shopper (same-origin URL allow-list; no
arbitrary navigation). Align with the existing in-review implementation rather than
duplicating. **Commit:** `Add storefront page navigation tool`

## WP14 — order history / status (ACL-130)
Read the current customer's orders (requires logged-in session; degrade gracefully
when guest). Store API `/store-api/order`. `readOnlyHint: true`,
`untrustedContentHint` where order content is user-influenced. **Commit:**
`Add order history tool`

## WP15 — coupons + store info + variant helper (ACL-132)
- apply/remove promotion code (cart mutation);
- store/policy info (shipping/returns/legal pages) read tool;
- variant-selection helper: resolve product options → concrete variant id before
  `add_to_cart`.
Split into separate commits, one per tool.

## WP16 — tool-name alignment decision (ACL-131)
Decide: keep the `shopware_webmcp_*` namespace vs Shopify-aligned names/aliases.
Apply once via the factory (WP4) if aliases are wanted. Record the decision as a
short ADR. **Commit:** `Decide and apply tool naming policy`

---

## Risks & sequencing notes

- **WP4–WP7 are the heavy refactors.** Land WP1–WP3 first so every subsequent WP is
  guarded by lint + type-check + e2e.
- **Behavior stability:** WP5/WP6/WP7 are refactors — the e2e test is the safety net.
  If e2e coverage is thin, extend it before the big splits.
- **Contract stability:** never change `structuredContent` keys or tool names inside
  a refactor WP; only WP16 changes names, deliberately.
- **Rebase:** when the 4 base PRs merge, rebase this branch onto `main` before
  continuing Phase 2.

## Final verification (whole plan)
`bun run check && bun run lint && bun run format:check && bun run build && bun run test:e2e`
green; `composer qa` green; README tool table and `config.xml` list every enabled
tool; ADR 0004 updated with the WP3 entrypoint outcome and the WP6 document decision.
