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

### ADRs

- [0001 — Categories via Store API](adr/0001-categories-store-api.md) —
  moving `get_product_categories` off DOM scraping onto the Store API navigation
  endpoint, plumbing the sales channel navigation root id.
- [0002 — WebMCP Integration Test Against a Real Shopware](adr/0002-testing-strategy.md)
  — one Playwright integration test driving `document.modelContext` against a real
  shop, run the same way locally and in the plugin CI (broader suite deferred).
- [0003 — TypeScript integration, architecture & conventions](adr/0003-typescript-architecture.md)
  — open-source readiness: fixing the strange TS build wiring, enforcing type-check
  + lint in CI, replacing boundary `any` with typed domain models, and structuring
  the runtime for external contributors.
- [0004 — Cart: session context, caching & declarative vs. imperative exposure](adr/0004-cart-context-caching-declarative.md)
  — **Proposed / open.** Grounded options (Shopware + WebMCP standard) for
  cart context-sync, cache-safety, and the imperative-vs-declarative /
  delta-vs-target-quantity questions, with a founded hybrid recommendation and
  shared plumbing for `get_sales_channel_context`.

### Specs

- [0001 — Improvements, Gaps & Roadmap](specs/0001-improvements-and-roadmap.md) —
  code/architecture improvements plus missing functions & use cases vs. the Linear
  MVP definition, status report, and Milestone 2 issues, with a prioritized
  roadmap.
- [0002 — TypeScript foundation implementation plan](specs/0002-typescript-foundation-implementation-plan.md)
  — commit-by-commit plan for the TypeScript foundation work (ADR 0003).
- [0003 — Module structure: adapter, transport, domain](specs/0003-module-structure-and-adapters.md)
  — the layering rule (transport vs domain vs adapter), the target folder hierarchy,
  and the concrete cuts to shrink shopware-client.ts and model-context-registry.ts.
- [0004 — Cart architecture implementation plan](specs/0004-cart-implementation-plan.md)
  — commit-by-commit (each a later MR) plan implementing ADR 0004: server-side
  `CartService` write endpoints, declarative-per-line tools, slimmed `cart-ui-sync`,
  auto-derived `.wmcp`.
