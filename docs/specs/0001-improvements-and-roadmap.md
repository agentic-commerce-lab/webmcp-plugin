# Spec — Improvements, Gaps & Roadmap

Date: 2026-07-17
Status: Draft
Baseline: [Architecture Overview](../Architecture.md)
Sources: current codebase (IST), Linear project *WebMCP Support*
(MVP Definition, Status Report, Showcase Brief) and Milestone 2 issues
ACL-126…ACL-132.

## Goal

Give a single, prioritized view of (A) what should be **improved** in the current
implementation (code health, best practices, file sizes) and (B) what
**functions / use cases are still missing** relative to the Linear MVP definition,
the status-report learnings, and the Milestone 2 issues.

This spec is a decision & backlog record. It does not implement anything.

---

## Part A — Code & architecture improvements

Severity: **P1** = correctness/maintainability risk or best-practice violation
that will bite soon · **P2** = meaningful debt · **P3** = polish.

> The TypeScript-specific items below (A1–A3, A7) are elaborated for **open-source
> readiness** in [ADR 0003 — TypeScript integration, architecture & conventions](../adr/0003-typescript-architecture.md):
> the strange JS-entry/two-compiler build wiring, unenforced type-checking, missing
> lint/format, boundary `any`, and module structure.

### A1. Single source of truth for the WebMCP contract — P1

**Problem:** the document/element/security contract is implemented twice — PHP
`WebMcpController.php:79-292` and TS `runtime.ts:78-390` — plus the `version`
string `'0.2'` hard-coded in both. Any change must be mirrored by hand; they will
drift.

**Direction:** make one side authoritative. Options, in order of preference:
1. PHP builds the document; the storefront fetches it from `/webmcp.wmcp` and the
   runtime stops rebuilding it client-side (removes ~300 lines of duplicated TS).
2. If the client must build it offline, extract a shared JSON contract fixture and
   generate both sides from it.

**Verification:** one place defines version/elements/security; a contract test (or
at minimum a build-time diff) proves PHP and TS agree.

### A2. Break up the god modules — P1

| File | Lines | Split into |
| --- | --- | --- |
| `runtime/shopware-client.ts` | 1302 | `store-api-client`, `cart-client`, `product-normalizer`, `cart-normalizer`, `cart-ui-sync`, `token-discovery` |
| `runtime.ts` | 897 | `bootstrap`, `document-builder` (or drop per A1), `tool-registry`, `native-bridge` |
| `tools/get-product-categories.tool.ts` | 876 | `category-tree` inference engine as its own module, thin tool wrapper on top |
| `Model/CartPayloadBuilder.php` | 378 | acceptable, but extract line-item + totals serializers |

AGENTS.md §2.2 already forbids "god objects / oversized files"; these violate it.

**Verification:** no runtime source file > ~300 lines; `tsc` + build still green.

### A3. Remove per-tool duplication with a shared factory — P2

The "exactly one of id/sku/url" validator (get-product `:79-83`, add-to-cart
`:88-92`, update-line-item `:115-119`, remove-from-cart `:95-99`),
`normalizeQuantity` (3 near-identical copies), and the `MAX_PRODUCT_ID_LENGTH` /
`MAX_SKU_LENGTH` / `MAX_URL_LENGTH` / `MAX_QUANTITY` constants are copy-pasted.
`removeEmptyValues`/`isPlainObject`/`parseJson` are each duplicated 2–3×.

**Direction:** a `createStorefrontTool()` factory + shared `productSelector` schema
+ shared validators/constants in `storefront-tool.utils.ts`. This also fixes the
recent top-level-`oneOf` class of bugs in one place instead of seven.

**Verification:** each tool file drops to schema + description + execute; shared
helpers covered once.

### A4. Fix dead / redundant logic — P2

- `runtime.ts` `upsertTool` (`:479-497`) computes `existingIndex`, returns, then
  recomputes an identical `registeredIndex` with the same predicate — the second
  block is dead. Remove it.
- `StorefrontToolOptions.contextToken` is threaded through every tool but never
  set by any caller. Remove or wire it.

### A5. Stop silent failure — P2

Invalid `staticElementsJson` returns `[]` with no signal
(`WebMcpController.php:150`); `runtime.ts parseJson` returns `null` silently.
Many `catch (e) { /* ignore */ }` blocks (`shopware-client.ts:277,715,786,918,1254,1283`;
`runtime.ts:548,716,779`) swallow everything.

**Direction:** distinguish "best-effort UI refresh" (ok to swallow, but log at
debug) from "config/contract error" (surface to admin / console warning). At
minimum, add a single debug-guarded logger so failures are observable.

### A6. Tighten PHP typing — P2

`SystemConfigWebMcpConfigProvider::__construct(private readonly object $systemConfigService)`
(`:11`) and `getConfig(mixed $salesChannelContext)` (`:15`) discard type safety;
`method_exists()` guards pervade the provider and `CartPayloadBuilder`
(`:32,148,183,192,224,341`). Use concrete Shopware types
(`SystemConfigService`, `?SalesChannelContext`) so the contract is explicit and
breakage surfaces at compile/lint time rather than as silent nulls.

### A7. Close QA/tooling gaps — P2

- `qa` runs **only** `php -l`. Add `bun run check` (TS type-check) to the default
  `qa` target so type errors fail before release, not only in `build-zip.sh`.
- Add static analysis: **PHPStan** (or Psalm) for PHP; consider `eslint` for TS.
- **No tests exist (0% coverage).** AGENTS.md §7.4 forbids adding a framework
  *without request* — so this is a decision to take, not a silent change. Minimum
  worth proposing: unit tests for input normalization/validators (pure functions,
  cheap) and a contract test for the WebMCP document. (See A1.)
- Dockerfile runs PHP **8.3** while composer platform pins **8.2.0** — align them.
- Remove the stray `package-lock.json` (Bun is the declared package manager).

### A8. Fix stale AGENTS.md — P3

AGENTS.md §1.2/§4.6/§6.1 describe a `src/Resources/public/webmcp-model-context.js`
vanilla-JS runtime that no longer exists. Update it to the TypeScript runtime under
`src/Resources/app/storefront/src/webmcp-model-context/`.

### A9. Harden untrusted-input parsing — P3

`get_product_categories` fetches and parses same-origin HTML with no
depth/size/line-item cap; `CartPayloadBuilder` has a child-recursion guard
(`level < 2`) but no total line-item cap. Add explicit size limits.

---

## Part B — Missing functions & use cases

### B1. Gap vs the Linear **MVP Definition** tool surface

| MVP tool | MVP priority | Status | Note |
| --- | --- | --- | --- |
| `search_products` | Must | ✅ done | as `shopware_webmcp_search_products` |
| `get_product` | Must | ✅ done | |
| `get_product_categories` | Must | ⚠️ partial | works, but **DOM-scraped**, not Store API — fragile, theme-dependent |
| `add_to_cart` | Must | ✅ done | |
| `get_cart` | Must | ✅ done | |
| `remove_from_cart` | Must | ✅ done | |
| `update_line_item` | Should | ✅ done | |
| `get_checkout_requirements` | Should | ❌ **missing** | read-only checkout metadata (address fields, countries, salutations, shipping/payment methods, tax display, currency, checkout URL) |
| `get_sales_channel_context` | **Differentiator** | ❌ **missing** | sales channel, language, currency, country, customer group, tax mode, active domain, enabled capabilities — the Shopware-specific edge |

**Two MVP-scoped tools are still missing**, including the explicitly named
differentiator (`get_sales_channel_context`).

### B2. Gap vs MVP **safety & governance** requirements

| Requirement | Status | Note |
| --- | --- | --- |
| Enable/disable toggle | ✅ | `enabled` |
| Separate read vs cart-mutation toggles | ⚠️ partial | per-tool toggles exist, but no read/write **grouping** or single mutation kill-switch |
| **User confirmation for cart mutations** | ❌ missing | no confirmation config, no confirmation surface / native confirmation hint |
| **Read/write classification in tool metadata** (`readOnlyHint`) | ❌ missing | Chrome security guide calls this out; not emitted |
| **`untrustedContentHint`** for product/user content | ❌ missing | product descriptions are attacker-controllable (prompt injection) |
| Store API as source of truth | ⚠️ partial | products ✅, cart via storefront routes, categories via DOM |
| Same shopper/session context | ✅ | context-token capture/replay |
| **Status endpoint** (version, enabled tools, browser reqs, safety posture) | ⚠️ partial | `/webmcp.wmcp` document exists, but no `/.well-known/webmcp-status` reporting version/tools/policy/safety/readiness |
| **Deterministic fallback harness** (gated behind demo setting) | ❌ missing | the earlier PoC had a gated `window.__SwagWebMcp.call`; current build exposes `window.SwagWebMcp` **ungated** and ships no harness |
| **Mutation audit logging** | ❌ missing | earlier PoC logged mutation audit events server-side; current build does not |
| No checkout/payment/account/admin in V1 | ✅ | correctly out of scope |

> The status report's own learnings flag three of these as important: tool
> descriptions are "security-critical UI", status endpoints are "essential", and
> native support must be reported honestly. The current build has regressed on the
> status endpoint, audit logging, and the gated harness compared to the described
> PoC.

### B3. Gap vs **Milestone 2** Linear issues

| Issue | Title | Status in Linear | In codebase |
| --- | --- | --- | --- |
| ACL-126 | Migrate to TypeScript | Todo | ✅ effectively done — storefront runtime is TypeScript; issue likely stale or refers to admin/tooling |
| ACL-127 | Page navigation tool | In Review | ❌ not in current `main` (agent can navigate storefront on behalf of user) |
| ACL-128 | "Create checkout" tool | Todo | ❌ missing — specialized navigate-to-checkout |
| ACL-129 | Clear cart tool | Todo | ❌ missing — dedicated clear-cart (today only via update qty 0 per item) |
| ACL-130 | Manage orders tool | Todo | ❌ missing — navigate to / fetch customer orders |
| ACL-131 | Align tool names with Shopify | Todo (Idea) | ❌ names are `shopware_webmcp_*`, not Shopify-aligned |
| ACL-132 | Consider new tools (Shopify parity) | Todo | ❌ analysis task — see B4 |

### B4. Gap vs **Shopify / market parity** (ACL-131, ACL-132)

From the status-report competitive analysis, Shopify Storefront MCP covers product
discovery, cart management, store information, **order management**, and
**customer-account** data. The WooCommerce WebMCP Bridge additionally exposes
**coupons** and checkout fields. Candidate additions, beyond the Milestone 2 list:

- **Order history / order status** (read) — aligns with ACL-130 and Shopify order
  management.
- **Store / policy information** — shipping, returns, contact, legal pages as a
  read tool (Shopify "store information").
- **Coupon / promo-code apply & remove** — WooCommerce Bridge parity; natural cart
  extension.
- **Shipping & payment method listing** — overlaps with `get_checkout_requirements`.
- **Product variant selection helper** — resolve options → concrete variant ID
  before `add_to_cart` (Shopware variants are a known hard case for agents).
- **Tool-name alignment** — decide a naming policy (Shopify-aligned aliases vs.
  the `shopware_webmcp_` namespace) once, then apply via the shared factory (A3).

---

## Prioritized roadmap

Ordering blends impact (MVP/differentiator, safety) with effort and dependency.

| # | Item | Type | Priority | Depends on |
| --- | --- | --- | --- | --- |
| 1 | `get_sales_channel_context` tool (differentiator, cheap, Store API) | Feature (B1) | P1 | A3 helps |
| 2 | Read/write tool metadata: `readOnlyHint` + `untrustedContentHint` | Safety (B2) | P1 | — |
| 3 | Single source of truth for the WebMCP contract | Debt (A1) | P1 | — |
| 4 | Shared tool factory + validators (kills boilerplate & schema-bug class) | Debt (A3) | P1 | — |
| 5 | `get_checkout_requirements` tool | Feature (B1) | P1 | 1 |
| 6 | Proper status endpoint `/.well-known/webmcp-status` | Safety (B2) | P2 | 3 |
| 7 | Split god modules (`shopware-client.ts`, `runtime.ts`, categories) | Debt (A2) | P2 | 4 |
| 8 | Confirmation policy for cart mutations + admin toggle | Safety (B2) | P2 | 2 |
| 9 | `clear_cart` (ACL-129) + `create_checkout` (ACL-128) tools | Feature (B3) | P2 | 4 |
| 10 | Land page-navigation tool (ACL-127) into main | Feature (B3) | P2 | 4 |
| 11 | Mutation audit logging (server-side) | Safety (B2) | P2 | — |
| 12 | ~~Move `get_product_categories` off DOM scraping onto Store API~~ ✅ done — see [ADR 0001](../adr/0001-categories-store-api.md) | Debt (B1) | P2 | — |
| 13 | QA: add TS check to `qa`, PHPStan, align PHP 8.2/8.3, drop package-lock | Debt (A7) | P2 | — |
| 14 | Order management / order status (ACL-130) | Feature (B3/B4) | P3 | 1 |
| 15 | Shopify tool-name alignment decision (ACL-131) | Feature (B4) | P3 | 4 |
| 16 | Coupons, store-info, variant-helper, shipping/payment listing (ACL-132) | Feature (B4) | P3 | 4,5 |
| 17 | Gated deterministic fallback harness | Safety (B2) | P3 | — |
| 18 | Tighten typing, kill dead code, stop silent failure, fix AGENTS.md | Debt (A4–A6,A8,A9) | P3 | 7 |

## Non-goals

- Checkout submission, payment authorization, account mutation, admin tools —
  explicitly out of scope for V1 per the MVP definition and status report.
- A full test suite in this spec — A7 only proposes the decision and a minimal set.

## Risks

- **Contract drift** (A1) is the highest-leverage debt: every new tool doubles the
  work while PHP and TS diverge. Address before adding many tools.
- **Prompt injection via product content** (B2): shipping catalog/cart tools
  without `untrustedContentHint` and read/write hints understates a real risk the
  status report already flagged.
- **DOM-scraped categories** (B1): theme changes can silently break
  `get_product_categories`; it also contradicts "Store API as source of truth".

## Verification (of this spec's follow-up work)

Each roadmap item ships with: updated README tool table, `bun run check` + build
green, `composer qa` green (with TS check added per A7), and — where a contract
changes — the single-source contract test from A1.
