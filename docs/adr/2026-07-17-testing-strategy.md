# ADR 0003 — WebMCP Integration Test Against a Real Shopware

Date: 2026-07-17
Status: Accepted (implemented)

## What

One Playwright suite (`tests/e2e/webmcp-tools.spec.ts`) that drives **all 7 WebMCP
tools** through `document.modelContext.callTool(...)` against a real Shopware
storefront. Runs the same way locally and in CI; the CI `test` job gates the ZIP
build.

## Why

- The tools only execute **in a browser against a live shop** (they call the Store
  API / cart routes and register into `document.modelContext`). Mocking that proves
  nothing — the only honest test drives a real storefront.
- We don't want to maintain our own Shopware CI, so CI uses an **off-the-shelf,
  pre-installed image** instead of an install/seed pipeline of our own.

## How

- **Test:** Playwright calls each tool as an agent would and asserts on
  `structuredContent`. Assertions are structural (search returns `count > 0`; the
  cart lifecycle chains real identifiers from search results) — **no hard-coded demo
  IDs**, so it doesn't go flaky.
- **Shopware:**
  - Locally → the developer's running `shopware-cli` project.
  - In CI → the pinned **`dockware/shopware:6.7.12.1`** image (Shopware + demo data
    baked in; determinism comes from the pinned tag).
  - One command, base URL from `SHOPWARE_BASE_URL` (default
    `http://127.0.0.1:8000`): `bun run test:e2e`.
- **CI** (`.github/workflows/build-plugin-zip.yml`): the `test` job builds the
  storefront asset, boots Dockware, copies in + activates the plugin, compiles the
  theme, and runs the suite. `build-plugin-zip` depends on it; tests also run on
  pull requests.

## Deferred

Unit tests, PHP test-kernel tests, the PHP↔TS contract test, and a multi-version
matrix stay on the roadmap (A1/A7 in
[`../specs/2026-07-17-improvements-and-roadmap.md`](../specs/2026-07-17-improvements-and-roadmap.md)).
This ADR ships only the one real integration test.
