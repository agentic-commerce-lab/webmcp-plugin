# Implementation Plan: TypeScript Foundation & Module Refactor

Date: 2026-07-17 (revised 2026-07-19)
Status: **Foundation implemented** on `refactor/typescript-foundation` (WP1–WP6, WP8);
open: the `storeApiRequest` extraction (WP5 tail) and domain typing (WP7)
Basis: [ADR 0003 — TypeScript architecture & conventions](../adr/0003-typescript-architecture.md) ·
[ADR 0006 — Tool discovery contract](../adr/0006-tool-discovery-contract.md) ·
[Improvements & Roadmap](0001-improvements-and-roadmap.md) ·
[ADR 0001 — Categories via Store API](../adr/0001-categories-store-api.md)

> **SSOT for the TypeScript / architecture *refactor execution*** — the
> commit-by-commit foundation work and the remaining module decomposition. The
> *decisions and conventions* (build model, tsconfig, typing rules, the layering
> rule) are in [ADR 0003](../adr/0003-typescript-architecture.md). *Feature tools*
> (new WebMCP tools, Shopify parity) live in the [roadmap](0001-improvements-and-roadmap.md),
> not here.

## How to execute this plan

- **Base branch:** `refactor/typescript-foundation`.
- **Work in order.** Each work package (WP) is one commit (or a small stacked PR). Do
  not reorder unless a dependency note allows it.
- **Definition of done per WP:** `bun run check`, `bun run lint`,
  `bun run format:check`, `bun run build` all green; where a WP changes runtime
  behavior, the Playwright e2e (`bun run test:e2e`) stays green; commit messages carry
  no agent/tool names (see the preparing-merge-requests conventions).
- **Golden rule:** every WP keeps the plugin installable and the tool contract
  (`structuredContent` shapes, tool names, browser globals) stable unless the WP
  explicitly changes it. No behavior change hidden inside a "refactor" WP.

## Conventions introduced by this plan

- **zod is the single source of truth for tool input:** one `z.object(...)` per tool
  yields (a) the runtime validator and (b) the JSON Schema (via `zod-to-json-schema`).
  zod `.refine()` for "exactly one of id/sku/url" is runtime-only and does **not** emit
  a top-level `oneOf`, so the schema stays function-calling-API compatible.
- **Domain types:** `any`/`UnknownRecord` is allowed only in the fetch/parse layer;
  Store API and cart payloads are parsed into typed models at the client boundary.
- **Module layout (target)** — the layering rule (`tools → adapter → transport/domain`)
  is the convention in [ADR 0003 §6](../adr/0003-typescript-architecture.md):
  ```
  webmcp-model-context/
    runtime.ts              bootstrap, config, tool registration
    config.ts               config parse
    tools/
      define-tool.ts        shared factory
      schemas.ts            shared zod schemas (productSelector, quantity, …)
      *.tool.ts             thin: schema + execute
    model-context/
      registry.ts           register/unregister + upsert guards
      native-bridge.ts      document.modelContext integration
    transport/
      http.ts               response parsing + errors
      store-api.ts          storeApiRequest() (typed)
      token-discovery.ts    context token / access key readers
      paths.ts              endpoint path constants
    domain/
      product.ts category.ts cart.ts   schemas + inferred types + normalizers
    shopware-client.ts      adapter/facade: session context + orchestration
    cart-ui-sync.ts         best-effort storefront UI refresh
    types.ts globals.d.ts
  ```

---

# Phase 1 — Foundation

| WP | Goal | Status |
| --- | --- | --- |
| WP1 | ESLint + Prettier + a `quality` CI job (type-check + lint + format), gating the ZIP build | ✅ done |
| WP2 | Split `tsconfig` into browser/node projects; add the stricter flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …) | ✅ done |
| WP3 | TypeScript entrypoint — Shopware resolves `main.ts` ahead of `main.js`, so the JS shim was removed; drop `allowJs`/`checkJs` | ✅ done |
| WP4 | `defineTool` factory + shared zod `schemas.ts` + `readOnlyHint` / `untrustedContentHint`; all tools refactored onto it; generated `inputSchema` has no top-level combinator | ✅ done |
| WP5 | Split `shopware-client.ts` into `transport/` + `domain/` + `cart-ui-sync` (facade keeps a stable public method surface) | ◐ partial — see **Module refactor** |
| WP6 | Split `runtime.ts`; extract `model-context/registry.ts` + `native-bridge.ts` (incl. the `upsertTool` dead-code fix) | ✅ done |
| WP7 | Domain types — confine `any`/`UnknownRecord` to the parse layer; `storeApiRequest<T>()`; zod schemas in `domain/*` | ☐ remaining (~104 boundary `any`/`UnknownRecord` still spread beyond the parse layer) |
| WP8 | Contributor ergonomics — PHPStan + PHP-CS-Fixer in `composer qa`; `CONTRIBUTING.md`; Dockerfile aligned to PHP 8.2; stray `package-lock.json` removed | ✅ done |

> **WP6 note — the WebMCP document decision changed.** WP6 originally proposed making
> the PHP `/webmcp.wmcp` endpoint the single source of the WebMCP document. That was
> overtaken: the bespoke document is **removed entirely**, and `document.modelContext`
> is the sole discovery contract — see [ADR 0006](../adr/0006-tool-discovery-contract.md).
> The `runtime.ts` split itself (bootstrap / registry / native-bridge) is done.

## Module refactor (remaining decomposition — WP5 tail)

The layering rule is in [ADR 0003 §6](../adr/0003-typescript-architecture.md). What is
already done: `shopware-client.ts` is down from ~1302 to ~336 lines over `transport/`
+ `domain/`; the model-context registry and native bridge are extracted. What remains:

- **Extract `storeApiRequest` → `transport/store-api.ts`.** It is the last transport
  primitive still living in the facade; move it out so `shopware-client.ts` is pure
  orchestration (resolve product → call transport → normalize via `domain/`).
- **Add `domain/cart.ts`.** Cart normalization lands here as part of the cart
  migration ([Spec 0003, C4](0003-cart-implementation-plan.md)); it completes the
  `domain/` set (`product.ts`, `category.ts`, `cart.ts`).

> The earlier "de-duplicate / relocate the *storefront* cart write transport" steps
> are **obsolete**: ADR 0004 moves cart writes server-side, so that whole
> `storefront-cart` transport (form-POST helper, CSRF discovery,
> `findStorefrontCartLineItem`, the three write ops) is **deleted**, not refactored —
> see [Spec 0003, C2](0003-cart-implementation-plan.md).

## WP7 — Domain types (remove boundary `any`)

In `domain/product.ts`, `domain/category.ts`, `domain/cart.ts`: zod schemas for the
**subset** of the Store API / cart payloads actually consumed; `z.infer` types;
`parse`/`safeParse` in the normalizers. Type `storeApiRequest<T>(path, body, schema):
Promise<T>` so the boundary is the only place `any` appears. Drive the
`UnknownRecord`/`any` counts (baseline: 83 `UnknownRecord`, 44 `any`) to near-zero
outside `domain/*` parse functions and `globals.d.ts`.
- **Verification:** `tsc` (WP2 flags) + `lint` + `build` + e2e green; grep shows `any`
  only in the parse layer.
- **Commit:** `Add typed domain models for Store API and cart payloads`

## WP8 — Contributor ergonomics & housekeeping — ✅ done

Delivered: `CONTRIBUTING.md` (architecture map, the two build channels, how to add a
tool, how to run `check`/`lint`/`format`/`build`/`test:e2e`); `composer qa` runs
PHPStan (level 8, clean) + PHP-CS-Fixer; the `Dockerfile` is aligned to PHP 8.2
(matching the composer platform); the stray `package-lock.json` is gone (Bun is
canonical).

---

## Risks & sequencing notes

- **Behavior stability:** WP5/WP7 are refactors — the e2e test is the safety net. If
  e2e coverage is thin, extend it before the splits.
- **Contract stability:** never change `structuredContent` keys or tool names inside a
  refactor WP.

## Final verification (whole plan)

`bun run check && bun run lint && bun run format:check && bun run build && bun run
test:e2e` green; `composer qa` green; README tool table and `config.xml` list every
enabled tool.
