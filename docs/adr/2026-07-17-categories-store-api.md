# ADR 0002 — Move `get_product_categories` from DOM scraping to the Store API

Date: 2026-07-17
Status: Accepted
Relates to: [ADR 0001 — Architecture Overview](2026-07-17-architecture-overview.md) ·
[Improvements & Roadmap](../specs/2026-07-17-improvements-and-roadmap.md) (item B1 / #12)

## Context

`shopware_webmcp_get_product_categories` was the only tool that did **not** use the
Store API. It inferred the category tree by scraping the rendered DOM:

- **tree scope**: parsed theme navigation links (`.main-navigation-link`,
  `.navigation-flyout-link`, …) from the current or a fetched page.
- **product scope**: parsed breadcrumbs (schema.org `BreadcrumbList` / `.breadcrumb`).

This required ~876 lines of inference logic (synthetic id generation, parent
inference from URL structure, cycle detection, breadcrumb parsing) and had real
drawbacks:

- **Fragile / theme-dependent** — any theme that changes navigation markup
  silently breaks the tool.
- **No real identifiers** — categories carried synthetic ids, not Shopware UUIDs,
  so results could not be used to drive further Store API calls.
- **Contradicts "Store API as source of truth"** (MVP governance requirement).
- **Disproportionate size** — a single tool file was ~5× larger than any other.

The Store API already exposes the navigation tree
(`POST /store-api/navigation/{activeId}/{rootId}`) and product categories (via the
product detail `categories` association). The only missing piece on the browser
side was the **sales channel navigation root category id** (`rootId`), which the
storefront knows but the runtime was not given.

## Decision

Rewrite the tool to use the Store API, and plumb the navigation root id from the
storefront to the runtime the same way the public `storeApiAccessKey` is already
passed.

1. **Plumb `navigationCategoryId`** (Twig `context.salesChannel.navigationCategoryId`)
   → `meta.html.twig` config JSON → `WebMcpRuntimeConfig` / `StorefrontToolOptions`
   → `ShopwareClient`.
2. **`ShopwareClient.getNavigationCategories(depth = 2)`** →
   `POST /store-api/navigation/{rootId}/{rootId}` with `{ depth, buildTree: true,
   associations: { seoUrls: {} } }`, normalized into a nested tree.
3. **`ShopwareClient.getProductCategories({id|sku|url})`** → resolves the product,
   reads its `categories` association, returns them as active leaf categories.
4. **Rewrite the tool** (876 → 179 lines): input `scope` (`tree`|`product`) plus
   `id`/`sku`/`url` for product scope; all DOM scraping removed.

### Output contract change

The `structuredContent` keys are preserved
(`lookup, scope, source, sourceUrl, count, activeCategoryIds, categories, tree`),
with intentional, documented improvements:

| Field | Before (DOM) | After (Store API) |
| --- | --- | --- |
| `source` | `navigation` / `breadcrumbs` | `store-api` |
| category `id` | synthetic (derived from href) | real Shopware category UUID |
| category `url` | href from DOM | canonical SEO URL, else `/navigation/{id}` |
| dropped fields | `idSource`, `shopwareId`, `childIds` | removed (DOM-inference internals) |
| category node | `{id,idSource,name,parentId,childIds,active,url,children}` | `{id,name,parentId,active,url}` (+ `children` in `tree`) |

This is an intentional contract update (allowed by AGENTS.md §4.5) and is a strict
improvement: results now carry real IDs usable by other tools.

## Alternatives considered

- **Keep DOM, harden selectors** — rejected: still theme-fragile, still no real
  IDs, still 800+ lines, still violates "Store API as source of truth".
- **Hybrid (API with DOM fallback)** — rejected: keeps the fragile code the change
  is meant to delete. If `navigationCategoryId` is missing the tool now returns a
  clear error instead of silently degrading.
- **Full ancestor reconstruction for product scope** — deferred: product scope
  returns the product's assigned (leaf) categories; building full ancestor chains
  from category `path` can be added later if needed.

## Consequences

**Positive**
- Robust, theme-independent; real Shopware IDs; consistent with the other tools.
- Tool shrinks ~5× (876 → 179); category normalization lives in the client next to
  the existing product/cart normalizers.

**Negative / trade-offs**
- **Requires `navigationCategoryId`** to be exposed by the storefront; older cached
  pages without it will error until the theme/snippets are recompiled.
- Adds `getNavigationCategories` / `getProductCategories` to the already-large
  `shopware-client.ts` (god-module split is tracked separately in the roadmap, A2).
  The broader "strange TypeScript integration / big files / structure" feedback
  raised in review is captured in
  [ADR 0004 — TypeScript integration, architecture & conventions](2026-07-17-typescript-architecture.md).

## Addendum (2026-07-17) — current-page context

The first cut of this change had no reliable "currently viewed" signal, so
`activeCategoryIds` was mis-derived from the Store API `active` (enabled) flag —
which is true for every visible category, making the field meaningless. Fixed by
injecting the current-page context server-side, the same way as `navigationCategoryId`:

- **`activeCategoryId`** — from `page.category.id` (fallback `page.navigationId`) on
  navigation/category pages. `getNavigationCategories` now marks the active category
  **and its ancestors** (`active: true`), so `activeCategoryIds` returns the active
  trail. `page.header.navigation.active` was tried first but only reflects menu
  highlighting and returned null on listing pages.
- **`currentProductId`** — from `page.product.id` on product pages. `product` scope
  may now omit `id`/`sku`/`url` and defaults to the product the shopper is currently
  viewing.

Both are page-load snapshots (guarded with Twig `is defined`); on full-page
navigation — the Shopware default — they are always correct.

## Verification

- `bun run check` (tsc) — green. `bun run build` — storefront dist rebuilt;
  `theme:compile` deployed to the running demo shop.
- `POST /store-api/navigation/{root}/{root}` with the storefront access key returns
  the real category tree (3 top-level categories with UUIDs + nested children).
- Storefront config block (live): `navigationCategoryId` set on every page;
  `activeCategoryId` set to the viewed category on `/navigation/{id}` pages;
  `currentProductId` set on product pages; both `null` where not applicable.
- Served theme JS contains the navigation Store API call and the current-page
  handling; the earlier top-level `oneOf` schema fix still holds (0 occurrences).
- README tool reference updated to reflect the Store API source and new fields.
