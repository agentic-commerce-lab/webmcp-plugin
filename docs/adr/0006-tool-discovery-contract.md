# ADR 0006 — Tool discovery contract: `document.modelContext` is the single source of truth

Date: 2026-07-18
Status: Accepted — **implemented** on `refactor/typescript-foundation` (commit `b2cd66d`, not yet merged to `main`)
Relates to: [Architecture Overview](../Architecture.md) ·
[ADR 0003 — TypeScript architecture](0003-typescript-architecture.md) ·
[ADR 0004 — Cart architecture](0004-cart-architecture.md) ·
[Improvements & Roadmap](../specs/0001-improvements-and-roadmap.md)

> This ADR settles a question that used to be entangled with the cart work and the
> TypeScript refactor: **is there a static, server-side WebMCP "document" describing
> the tool surface, and if so who owns it?** The answer is *no static document* — the
> live `document.modelContext` registry is the only contract. This dissolves the
> PHP↔TS "single source of truth" duplication (roadmap A1) by deletion rather than by
> building a sync pipeline.

## Context

The plugin originally maintained **two** tool contracts side by side:

1. an **imperative** tool registry in the runtime — `native-bridge.ts` →
   `document.modelContext.registerTool` — matching the W3C imperative dictionary; and
2. a bespoke **declarative** document emitted by PHP at `/webmcp.wmcp`
   (`application/webmcp+json`, `version 0.2`: `elements[]` with
   `selector`/`role`/`action`/`csrf_tag`, `security.endpoints[].scopes`).

The document was **re-implemented in both PHP and TypeScript**, with the `version`
string hard-coded in each — a guaranteed drift source (roadmap A1). The question was
how to make one side authoritative: have the storefront fetch the document from PHP,
or generate both from a shared fixture.

An interim step made the document *derive* from the tool registry (project the tool
list into `.wmcp`). We then asked whether the document is worth keeping at all.

## Decision

**Remove the bespoke document entirely. `document.modelContext` is the single source
of truth for tool discovery.**

Concretely:

- Delete the `/webmcp.wmcp` route and its builder/normalizers from
  `WebMcpController`.
- Delete the TypeScript twin (`document.ts` / `buildWebMcpDocument`) and its
  `document.webMcp` / `getDocument` / `getElements` / `webmcp:document-*` surface.
- Remove the now-orphaned config fields that only fed it — `context` and
  `staticElementsJson` — plus their `config.xml` / `WebMcpConfig` / normaliser
  plumbing.

## Rationale

- **WebMCP is a runtime-only standard.** Per the authoritative sources (Chrome for
  Developers / the W3C WebML CG), WebMCP is `navigator` / `document.modelContext`
  (imperative `registerTool`) plus declarative HTML form attributes. It defines **no**
  static server-side discovery: no `.well-known`, no file extension, no MIME type. The
  spec even lists "tool discoverability: clients must visit the site directly" as a
  known *limitation*.
- **`/webmcp.wmcp` + `application/webmcp+json` + the `elements`/`security` shape was a
  bespoke invention** of this plugin. It matched no standard, and nothing — browser
  agent or crawler — looked for it. Browser agents read `document.modelContext`, which
  the runtime already populates correctly.
- **The `/.well-known/webmcp` manifest some third-party guides describe is an
  ecosystem convention, not part of the W3C spec** — an unstable, moving target.
- Deleting the document **dissolves the PHP↔TS SSOT problem** (roadmap A1) without
  building and testing a sync pipeline for an artifact nothing consumes.

## Consequences

- The runtime advertises exactly the enabled, registered tools; each tool's zod schema
  generates its own JSON Schema, so there is no second place for the contract to drift.
- Two config fields (`context`, `staticElementsJson`) disappear from the admin card.
- **If static discovery ever matters** — a non-browser consumer, or the
  `/.well-known/webmcp` convention stabilises / is standardised — revisit with a
  **TS-authored, build-generated manifest served at the standard path and shape**, not
  a bespoke `.wmcp`. Re-open this ADR then.

## Verification

- No `/webmcp.wmcp` route exists; `grep` finds no `buildWebMcpDocument` /
  `application/webmcp+json` / `staticElementsJson`.
- Browser agents discover the full tool surface from `document.modelContext` alone;
  the e2e suite drives every tool through `document.modelContext.callTool(...)` (ADR
  0002) with no dependency on a static document.

Sources: [WebMCP — Chrome for Developers](https://developer.chrome.com/docs/ai/webmcp) ·
[webmachinelearning/webmcp (W3C CG)](https://github.com/webmachinelearning/webmcp) ·
[WebMCP Reality Check](https://studiomeyer.io/en/blog/webmcp-reality-check-may-2026).
