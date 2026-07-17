# ADR 0003 — WebMCP Integration Test Against a Real Shopware

Date: 2026-07-17
Status: Accepted (implemented)

> **Implemented 2026-07-17.** Pinned to `dockware/shopware:6.7.12.1` (matches local
> SW core). Playwright suite `tests/e2e/webmcp-tools.spec.ts` covers all 7 tools and
> is green locally against the running project; the CI `test` job in
> `.github/workflows/build-plugin-zip.yml` gates the ZIP build. Run locally with
> `bun run test:e2e` (defaults to `http://127.0.0.1:8000`).

> Target-state decision record. Realizes the "add tests" gap from ADR 0001 §8 and
> roadmap A7 in
> [`../specs/2026-07-17-improvements-and-roadmap.md`](../specs/2026-07-17-improvements-and-roadmap.md).
> **Scope is deliberately minimal:** one integration test that drives the WebMCP
> tools against a real Shopware shop, running the same way locally and in the
> plugin's GitHub pipeline, using an **off-the-shelf, pre-installed Shopware image**
> so we do not maintain a bespoke CI shop. A broader unit/contract suite is
> explicitly deferred (see §6).

## 1. Context

- **0% coverage today.** Verification is `php -l` (`composer qa`) plus an
  out-of-band `tsc --noEmit` in `bin/build-zip.sh`. No behavior is tested.
- **The tools only exist at runtime in a browser.** A tool call
  (`shopware_webmcp_search_products`) runs as TypeScript inside a storefront page,
  reads `document.modelContext`, and calls the Store API / cart routes of a live
  Shopware. "Tell WebMCP to list products and it lists products" is therefore
  inherently a **browser + running Shopware** scenario — mocks would test nothing
  worth testing.
- **Two environments must run the same test:**
  - **Locally**, the plugin sits inside a full `shopware-cli` project: SW core
    `6.7.12.1`, `ghcr.io/shopware/docker-dev:php8.5-…`, MariaDB, storefront on
    `http://127.0.0.1:8000` (`compose.yaml`). Shopware is *already up*.
  - **In the plugin CI** (`build-plugin-zip.yml`) the repo is standalone and only
    builds a ZIP — **no Shopware, no DB**. CI must get one **without us hand-rolling
    an install/seed pipeline we then have to keep working.**
- **Framework gate.** `AGENTS.md` §7.4 forbids adding a test framework *without
  explicit request*. This ADR is that request; accepting it clears the gate for
  Playwright.
- **Priorities set for this decision:** the test must be **reliable, not flaky**,
  and we must **not maintain our own Shopware CI** — if an off-the-shelf piece
  exists, use it.

## 2. Goal

One integration test — the smallest thing that proves WebMCP works end-to-end
against a real shop — that:

1. drives the tools through the **same public API an AI agent uses**
   (`document.modelContext.callTool`);
2. runs against a **real Shopware storefront**, not mocks;
3. runs with **one command** locally and in CI;
4. gets its Shopware in CI from a **maintained, pre-installed image** — no bespoke
   install/seed scripts of ours to babysit.

Non-goal for now: exhaustive coverage. First we want a single green "it lists
products" signal in the pipeline; everything else builds on that later.

## 3. Decision

### D1 — Playwright, driving `document.modelContext` against a real storefront
A single Playwright spec loads a storefront page, waits for the runtime to
register, and calls the tool the way an agent would:

```ts
const result = await page.evaluate(() =>
  document.modelContext.callTool('shopware_webmcp_search_products', { query: 'shirt', limit: 5 }));
expect(result.structuredContent.products.length).toBeGreaterThan(0);
```

This is exactly "tell WebMCP to list products and it lists products", asserted on
`structuredContent`. It exercises the native bridge, tool registration, the Store
API transport, and the admin config toggles in one real path. **Rationale:** the
tools cannot execute outside a browser, so a browser driver is the only honest
integration test; Playwright is the modern default and runs headless in CI
cleanly.

### D2 — CI Shopware = the **Dockware** pre-installed image (with demo data baked in)
CI does **not** install or seed Shopware. It pulls a **version-pinned
`dockware/shopware` image** — a fully installed Shopware that already contains
**demo data** — copies the plugin in, activates it, and runs the test:

```yaml
# sketch, not final
- run: docker run --rm -d -p 80:80 --name shop dockware/shopware:6.7.x.x
- run: sleep 30                                   # let services come up (health-gate in final)
- run: docker cp "$(pwd)/." shop:/var/www/html/custom/plugins/SwagWebMcp
- run: docker exec shop bash -c "chown -R www-data:www-data custom/plugins && \
        php bin/console plugin:refresh && \
        php bin/console plugin:install SwagWebMcp --activate && \
        php bin/console cache:clear"
- run: SHOPWARE_BASE_URL=http://localhost npx playwright test
```

**Rationale:** this is the "don't maintain our own CI shop" requirement, met
directly — Dockware is a maintained, purpose-built Shopware image widely used for
plugin E2E, and it ships Shopware **already installed with demo data**, so there is
no `system:install` / `framework:demodata` / `theme:compile` pipeline of ours to
keep green. It supports Shopware 6.7 and is explicitly documented for GitHub
Actions + Playwright/Cypress. **Trade-off:** Dockware is maintained by dasistweb
(community/de-facto standard, referenced in Shopware's own docs), not by Shopware
SE — accepted risk, see §7. (Considered and rejected for *this* step: the official
`shopware/setup-shopware` action — it installs SW/PHP/MySQL/Node and can build the
storefront, but ships **no demo data** and builds assets in-runner, i.e. more
moving parts we'd own and less determinism. Good candidate later for PHPUnit
kernel tests; overkill here.)

### D3 — Determinism comes from **pinning the image tag**, not from seeding
The demo catalog is **baked into the pinned `dockware/shopware:6.7.x.x` tag**, so
it is identical on every run by construction — no `framework:demodata` invocation
whose output could vary. Assertions target that **known, baked catalog**: assert
the search returns hits / the catalog is non-empty (and, if useful, that a term
known to exist in Dockware demo data matches) — **never** hard-coded demo IDs.
**Rationale:** this is what makes the test non-flaky and satisfies the "fixed
product count" intent — the count is fixed by the tag, and bumping SW versions is a
deliberate tag change, not a silent drift.

### D4 — Same one command locally and in CI
`bun run test:e2e` (→ `playwright test`), base URL from `SHOPWARE_BASE_URL`:
- **Locally:** defaults to the developer's already-running project
  (`http://127.0.0.1:8000`). No second stack, no Dockware needed locally.
- **In CI:** points at the Dockware container (D2).

**Rationale:** one entrypoint, one mental model; the only difference between local
and CI is an env var.

### D5 — A `test` CI job, gating the ZIP build; one version, no matrix
Add a job (in `build-plugin-zip.yml` or a small `test.yml`) that runs the Dockware
setup, executes `npx playwright test`, and uploads the Playwright trace/video on
failure. Make the existing zip build **depend on it**. Test against **one pinned
Shopware version** (track ~6.7.x, matching local) — **no multi-version matrix, no
nightly floor job**. **Rationale:** matches the "keep it simple" scope; don't
publish a build whose tools are broken; a matrix can come later if a regression
ever justifies it.

## 4. Shape

- `tests/e2e/search-products.spec.ts` — the first and only required spec: search
  returns products. (Kept out of the shipped ZIP — `.shopware-extension.yml`
  already excludes `tests/`.)
- `playwright.config.ts` — base URL from `SHOPWARE_BASE_URL` (default
  `http://127.0.0.1:8000`), a small retry count, `trace: 'on-first-retry'`.
- `package.json` → `"test:e2e": "playwright test"`; add `@playwright/test` (dev
  only).
- `.github/workflows/…` — the `test` job: run Dockware, `docker cp` + activate the
  plugin, install Playwright browsers, run the spec, upload artifacts on failure.

No `compose.yaml`, no install/seed scripts of ours to maintain — the CI shop is the
pinned Dockware image. Follow-up specs, once the first is green, are cheap
additions in the same file tree: `get_product`, then the `add_to_cart → get_cart`
flow.

## 5. Verification & rollout

1. Add Playwright + `playwright.config.ts` + the `search-products` spec; run it
   locally against the running `:8000` project. *Verify:* green locally.
2. Add the CI `test` job using the pinned Dockware image; copy+activate the plugin,
   run the spec. *Verify:* green in CI; failure artifacts (trace/video) uploaded;
   zip build gated on it.

**Done when:** the pipeline pulls a pinned real Shopware (Dockware) with demo data,
runs the WebMCP tool in a browser, and the "lists products" assertion is green on
`main`, with the ZIP build depending on it.

## 6. Deferred (not now)

- TS/PHP **unit tests** (input normalizers, quantity clamps, config coercion).
- PHP **Shopware-test-kernel** integration tests (`/webmcp.wmcp`,
  `CartPayloadBuilder`) — where `shopware/setup-shopware` would be the natural fit.
- The **A1 single-source contract test** (PHP↔TS document drift).
- **Multi-version matrix** and a scheduled `6.6.10.18` floor job.
- Folding `tsc` into the default `qa` target (A7) — worthwhile, but independent.

These stay on the roadmap; this ADR intentionally ships only the one real
integration test first.

## 7. Risks

- **E2E flakiness.** *Mitigation:* baked demo data via a pinned tag (D3),
  health-gate the container (not a bare `sleep`), Playwright auto-waiting + a small
  retry count, trace-on-failure artifacts, and keeping it to one high-value spec.
- **Dockware is third-party** (dasistweb, not Shopware SE). *Mitigation:* it is the
  de-facto community standard, referenced in Shopware docs, and version-pinned;
  if it ever lapses, D2's structure swaps cleanly to `shopware/setup-shopware` +
  an explicit demodata step. Low switching cost because the test itself
  (Playwright + `SHOPWARE_BASE_URL`) is provisioning-agnostic.
- **Version drift** between the pinned Dockware tag and local (`6.7.12.1`).
  *Mitigation:* pin to the closest available `6.7.x` tag and bump deliberately;
  both are within the plugin constraint `>=6.6.10.18 <6.8.0`.
- **CI wall-clock** to pull the image + boot the shop. *Mitigation:* cache the
  Docker image layer; accept a slower `test` job since it runs a real shop.

## 8. Resolved at implementation

- **Pinned tag:** `dockware/shopware:6.7.12.1` (matches local SW core `6.7.12.1`).
- **Assertion style:** structural, not value-exact — search returns `count > 0`;
  the cart lifecycle chains real identifiers from search results; the DOM-scraped
  `get_product_categories` is asserted structurally (scope + `categories` array)
  to stay non-flaky against theme changes. No hard-coded demo IDs.
- **Scope covered:** all 7 tools, plus the `add → read → update → remove` cart
  lifecycle and the `update_line_item` "not in cart → skipped" branch — the
  regression net for refactoring the storefront runtime.
