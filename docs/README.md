# Documentation

Specs and architecture decision records (ADRs) for the Shopware WebMCP plugin.

- [Architecture Overview (IST)](Architecture.md) — the current architecture:
  system context, PHP backend, storefront runtime, tool surface, config flow,
  build/QA.

## Structure

- `adr/` — Architecture Decision Records. What was decided and why. Filename:
  `NNNN-topic.md`.
- `specs/` — Feature specs, improvement plans, and roadmaps. Filename:
  `NNNN-topic.md`.

Prefer Mermaid diagrams over long prose where a diagram is clearer.

## Index

Each ADR is the single source of truth for one **decision** (the "why"); each spec
owns one **plan or backlog** (the "what/how/when"). Where an ADR and a spec cover the
same topic they are cross-linked in their headers.

### ADRs

- [0001 — Categories via Store API](adr/0001-categories-store-api.md) —
  moving `get_product_categories` off DOM scraping onto the Store API navigation
  endpoint, plumbing the sales channel navigation root id.
- [0002 — WebMCP Integration Test Against a Real Shopware](adr/0002-testing-strategy.md)
  — one Playwright integration test driving `document.modelContext` against a real
  shop, run the same way locally and in the plugin CI (broader suite deferred).
- [0003 — TypeScript integration, architecture & conventions](adr/0003-typescript-architecture.md)
  — SSOT for the TS decisions and conventions: build wiring, tsconfig, lint/format,
  zod-as-schema-source, domain typing, and the `tools → adapter → transport/domain`
  layering rule. Execution lives in Spec 0002.
- [0004 — Cart architecture](adr/0004-cart-architecture.md) — **Accepted &
  implemented** (on `refactor/typescript-foundation`). The single cart decision record
  across context-sync, cache-safety, exposure/semantics (imperative `registerTool`,
  declarative per-line target, two product-keyed tools), server-side `CartService`
  execution (thin PHP bridge, no token in the browser), and frontend projection
  (`domain/cart.ts`). Consolidates the former ADR 0004 + 0006.
- [0005 — Admin WebMCP: runtime & API strategy](adr/0005-admin-runtime-and-api-strategy.md)
  — **Proposed (not started).** A second WebMCP runtime in the plugin's `administration` bundle
  (sharing a `webmcp-core`) that drives Shopware through the admin's own JS layer
  (`repositoryFactory` / domain services / router), reusing the merchant's live
  session and ACL rather than a direct Admin-API client or new server endpoints.
- [0006 — Tool discovery contract](adr/0006-tool-discovery-contract.md) —
  **Accepted & implemented** (on `refactor/typescript-foundation`). Removes the
  bespoke `.wmcp` document; `document.modelContext` (the live registered tools) is the
  single discovery contract. Dissolves the PHP↔TS contract duplication (roadmap A1) by
  deletion, not a sync pipeline.

### Specs

- [0001 — Improvements, Gaps & Roadmap](specs/0001-improvements-and-roadmap.md) —
  the SSOT for the **product/feature backlog**: code/architecture improvements plus
  missing functions & use cases vs. the Linear MVP definition, status report, and
  Milestone 2 issues, with a prioritized roadmap.
- [0002 — TypeScript foundation & module refactor](specs/0002-typescript-foundation-implementation-plan.md)
  — the SSOT for the **TS/architecture refactor execution**. **Foundation implemented**
  (WP1–WP6, WP8); open: the `storeApiRequest` extraction and domain typing (WP7).
  Implements [ADR 0003](adr/0003-typescript-architecture.md).
- [0003 — Cart architecture implementation record](specs/0003-cart-implementation-plan.md)
  — **implemented** (commits C1–C6): the shipped record of
  [ADR 0004](adr/0004-cart-architecture.md) — server-side `CartService` write
  endpoints, declarative-per-line tools, slimmed `cart-ui-sync`, frontend cart
  projection, `.wmcp` removal, `get_sales_channel_context`.
- [0004 — WebMCP in the Shopware Admin](specs/0004-admin-webmcp.md) — **not started.** Extend WebMCP
  to the Administration: full admin tool surface (products, orders, categories,
  CMS/landing pages, settings navigation), driven through the admin JS layer, with
  ACL gating, confirmation/visibility model, a CMS block-template abstraction, and a
  phased roadmap. Implements [ADR 0005](adr/0005-admin-runtime-and-api-strategy.md).
