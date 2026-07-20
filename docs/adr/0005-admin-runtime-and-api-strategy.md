# ADR 0005 — Admin WebMCP: a second runtime that drives the Admin JS layer

Date: 2026-07-19
Status: Proposed

> Companion to [Spec 0004 — WebMCP in the Shopware Admin](../specs/0004-admin-webmcp.md),
> which holds the full tool surface, use cases and roadmap. This ADR records only
> the two load-bearing decisions the rest of that spec depends on.

## Context

Today the plugin exposes a **storefront** as WebMCP tools (see
[Architecture Overview](../Architecture.md)). The storefront runtime boots inside
a shopper's browser tab, registers tools into `document.modelContext`, and reaches
Shopware through the public **Store API** plus a few storefront-scoped JSON
endpoints, all riding the shopper's anonymous session.

We now want an **admin** capability: while a merchant is logged into the Shopware
Administration, an AI-capable browser should be able to search and edit products,
manage orders, build categories and CMS/landing pages, and navigate to settings —
with the merchant watching it happen in the real admin UI.

The admin is a fundamentally different environment from the storefront:

- It is a **Vue SPA** (the `administration` bundle) served at `/admin`, not a
  server-rendered storefront. It is a different URL/origin-path and a different
  browser tab than the storefront, so an admin runtime and the storefront runtime
  **never share a `document`** — they cannot collide in `document.modelContext`.
- It runs under an **authenticated, ACL-scoped admin user**, not an anonymous
  shopper. Every action must respect that user's privileges.
- Shopware ships a large, relatively stable **in-page JS layer** in the SPA: the
  global `Shopware` object exposes the DAL `repositoryFactory`, `Criteria`, the
  API `Context`, domain services (`stateMachineService`, `syncService`, …), the
  Vue `$router`, the notification store, the ACL service, and the module registry.

Two questions decide everything downstream:

1. **Where does the admin runtime live**, and how does it relate to the storefront
   runtime?
2. **How does it talk to Shopware** — reuse the admin's own JS layer, or open a
   direct channel to the Admin API (`/api/*`) or to new server-side plugin
   endpoints?

## Decision 1 — A separate admin runtime in the plugin's `administration` bundle, sharing the tool-factory / model-context core

We add a second entry point at
`src/Resources/app/administration/src/main.ts`, compiled by Shopware's
administration build. It boots a dedicated **admin runtime** that registers
admin tools into `document.modelContext` using the same `defineTool` factory,
zod-schema-to-JSON-Schema plumbing, and native `modelContext` bridge the
storefront already uses.

We **do not** try to serve both surfaces from one runtime. Instead we extract the
environment-agnostic pieces (tool factory, shared zod selectors, model-context
registry + native bridge, debug-global conventions, safety-hint helpers) into a
shared `webmcp-core` module that both the storefront runtime and the admin runtime
import. Each runtime keeps its own transport/domain layer.

**Rationale.**

- The runtimes execute in different tabs and never coexist in one `document`, so
  merging them would only add dead code paths guarded by environment sniffing.
- A plugin's `administration` bundle is loaded **in-process** inside the SPA and
  can `import` the global `Shopware` object directly — no iframe, no postMessage
  bridge. This is strictly more capable than the alternative app-based path
  (Meteor Admin SDK), which is sandboxed in an iframe and cannot reach
  `repositoryFactory` directly. We stay a plugin.
- Sharing the *core* (factory, schema, bridge, safety hints) keeps the two
  surfaces from drifting on the parts that must stay identical (how a tool is
  shaped, validated, and advertised), while letting the parts that genuinely
  differ (how you fetch a product) diverge cleanly.

**Consequences.**

- A new admin build path is introduced (Shopware's `build administration` /
  webpack), in addition to the existing `Bun.build` storefront bundle. CI and the
  ZIP build must cover both.
- `webmcp-core` becomes a real internal package boundary; the current storefront
  runtime is refactored to consume it (a mechanical extraction, low risk).
- Admin tools are only ever registered when the runtime detects it is inside the
  admin SPA (`window.Shopware` present); they never leak into a storefront tab.

## Decision 2 — Drive Shopware through the admin's own JS layer (repositoryFactory / services / router), not a direct Admin-API client or new server endpoints

Admin tools perform their work by calling the **same JS APIs the admin UI itself
calls**:

- **Reads & writes** to entities go through the DAL
  `Shopware.Service('repositoryFactory').create('<entity>')` with
  `Shopware.Data.Criteria` and `Shopware.Context.api` — `search`, `get`, `save`,
  `create`, `delete`. This is the exact path every admin list/detail page uses.
- **Domain operations** that are not plain entity writes use the corresponding
  admin service: order/delivery/transaction state changes via
  `stateMachineService`, bulk edits via `syncService`, document generation via the
  document service, etc.
- **Navigation** uses the Vue router
  (`Shopware.Application.getApplicationRoot().$router.push(...)`), and **feedback**
  uses the notification store, so the merchant literally sees the admin move and
  react.

We explicitly reject two alternatives:

- **A direct Admin-API client** (`/api/*` with our own OAuth token handling).
  It would reimplement authentication, token refresh, ACL enforcement, entity
  hydration, and error/validation handling that the SPA already does correctly,
  and it would act *outside* the logged-in user's live session instead of within
  it.
- **New server-side plugin endpoints** (the pattern the storefront cart used).
  Admin actions are inherently per-user and ACL-scoped; doing them server-side
  would either bypass the admin user's privileges or force us to forward and
  re-validate the admin token in PHP — significant new backend surface for no
  gain, since the SPA already holds an authenticated, authorized context.

**Rationale.**

- **Reuse the merchant's real session and ACL.** The tool inherits exactly the
  privileges of the logged-in user. A user without `order.editor` cannot transition
  an order state through the tool, because the underlying service call fails the
  same way the button would. Safety comes from Shopware's own model, not from us
  re-deriving it.
- **The user sees what happens.** Because we go through the same repositories and
  the same router the UI uses, changes are reflected reactively in open views, and
  we can deliberately `$router.push` to the affected entity so the merchant
  watches the edit land. This is the core product promise.
- **Stability & correctness.** `repositoryFactory` + `Criteria` is Shopware's
  documented, long-lived internal contract for admin extensions; it handles
  associations, translations, versioning and write batching for us.
- **Least new backend.** No PHP endpoints, no token plumbing; the admin capability
  is almost entirely TypeScript inside the SPA.

**Consequences.**

- We take a dependency on admin-internal globals (`Shopware.*`). These are stable
  across patch releases but do shift across majors (notably the Vuex `State` →
  Pinia `Store` migration around 6.7, and router-access details). The runtime must
  **feature-detect** these access points and degrade gracefully, and the supported
  Shopware range must be tested in CI. This risk is called out in the spec.
- Tool availability must be **gated on ACL**: a tool is only registered/advertised
  when `Shopware.Service('acl').can(<privilege>)` is true, so the model never sees
  a capability the user cannot actually use.
- All the heavy lifting (variant resolution, CMS block composition) lives in TS in
  the admin bundle; that bundle will grow and needs the same module discipline the
  storefront runtime now has.

## Verification

- An admin runtime registers admin tools into `document.modelContext` only inside
  `/admin`; a storefront tab shows only storefront tools.
- A read tool (`admin_search_products`) and a write tool
  (`admin_transition_order_state`) both work end-to-end against a real Shopware via
  the repository/service layer, with the change visible in the admin UI.
- With a restricted admin user, an ACL-gated write tool is **not advertised**, and
  a forced call fails with the same authorization error the UI would raise.
- The shared `webmcp-core` is imported by both runtimes; neither redefines the
  tool factory or the native bridge.

## Status / next step

Proposed. If accepted, the phased build-out, the full tool catalog, the CMS-block
abstraction, the settings-navigation index, and the safety/confirmation policy are
specified in [Spec 0004](../specs/0004-admin-webmcp.md).
