# Documentation

Specs and architecture decision records (ADRs) for the Shopware WebMCP plugin.

## Structure

- `adr/` — Architecture Decision Records. What was decided and why. Filename:
  `NNNN-YYYY-MM-DD-topic.md` (or `YYYY-MM-DD-topic.md`).
- `specs/` — Feature specs, improvement plans, and roadmaps. Filename:
  `YYYY-MM-DD-topic.md`.

Prefer Mermaid diagrams over long prose where a diagram is clearer.

## Index

### ADRs

- [0001 — Architecture Overview (IST)](adr/2026-07-17-architecture-overview.md) —
  the current architecture: system context, PHP backend, storefront runtime, tool
  surface, config flow, build/QA.
- [0002 — Categories via Store API](adr/2026-07-17-categories-store-api.md) —
  moving `get_product_categories` off DOM scraping onto the Store API navigation
  endpoint, plumbing the sales channel navigation root id.
- [0003 — WebMCP Integration Test Against a Real Shopware](adr/2026-07-17-testing-strategy.md)
  — one Playwright integration test driving `document.modelContext` against a real
  shop, run the same way locally and in the plugin CI (broader suite deferred).
- [0004 — TypeScript integration, architecture & conventions](adr/2026-07-17-typescript-architecture.md)
  — open-source readiness: fixing the strange TS build wiring, enforcing type-check
  + lint in CI, replacing boundary `any` with typed domain models, and structuring
  the runtime for external contributors.

### Specs

- [Improvements, Gaps & Roadmap](specs/2026-07-17-improvements-and-roadmap.md) —
  code/architecture improvements plus missing functions & use cases vs. the Linear
  MVP definition, status report, and Milestone 2 issues, with a prioritized
  roadmap.
