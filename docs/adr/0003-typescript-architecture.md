# ADR 0003 — TypeScript integration, architecture & conventions (open-source readiness)

Date: 2026-07-17 (revised 2026-07-19)
Status: Accepted (foundation delivered — execution & remaining steps in Spec 0002)
Relates to: [Architecture Overview](../Architecture.md) ·
[ADR 0002 — Testing Strategy](0002-testing-strategy.md) ·
[ADR 0006 — Tool discovery contract](0006-tool-discovery-contract.md) ·
[TypeScript foundation & module refactor plan](../specs/0002-typescript-foundation-implementation-plan.md) ·
[Improvements & Roadmap](../specs/0001-improvements-and-roadmap.md) (A1–A3, A7)

> **SSOT for the TypeScript architecture *decisions* and *conventions*** (build
> model, tsconfig, lint/format, zod-as-schema-source, domain typing, and the module
> layering rule). The commit-by-commit *execution* — what is done and what remains —
> lives in the [TypeScript foundation & module refactor plan](../specs/0002-typescript-foundation-implementation-plan.md).

## Context

The repository is going to be **open-sourced** as a public Shopware community
reference plugin. That raises the bar: external contributors must be able to read
the storefront runtime, understand the architecture in minutes, and trust the type
safety. Internal review flagged two themes that triggered this ADR:

- Break up the large files, drop the DOM scraping, use the Store API more
  consistently, and add a CI pipeline.
- The TypeScript integration itself is unusual and worth cleaning up.

This ADR records **what is currently strange or weak about the TypeScript setup**
and the **target approach** for an open-source-grade TS codebase: clear structure,
explicit best practices, and state-of-the-art TypeScript usage and integration.

## Current state (IST)

### Build & integration wiring

```mermaid
graph TB
    subgraph Source["src/Resources/app/storefront/src"]
        MainJs["main.js (JS entry shim)"]
        Runtime["webmcp-model-context/**.ts"]
    end
    MainJs -->|imports| Runtime

    subgraph Dev["Dev / theme compile"]
        SwBuild["Shopware storefront build<br/>(Vite/esbuild, strips types, NO type-check)"]
        Theme["public/theme/**/swag-web-mcp.js"]
    end
    subgraph Release["ZIP release"]
        BunBuild["bin/build-storefront-dist.ts<br/>(Bun.build, minify)"]
        Dist["dist/** (gitignored, only inside ZIP)"]
    end
    Check["tsc --noEmit (bun run check)<br/>type-check only, NOT in composer qa"]

    Source --> SwBuild --> Theme
    Source --> BunBuild --> Dist
    Source -.type gate.-> Check
```

Facts (verified 2026-07-17):

- **JS entrypoint imports TS.** `main.js` is a `.js` shim (Shopware auto-discovers
  `main.js` as the storefront entrypoint) that imports the TS runtime. `tsconfig`
  therefore turns on `allowJs`+`checkJs` to cover the shim.
- **Two independent compilers build the same code.** Shopware's own storefront
  Vite/esbuild build compiles the TS for dev/theme; a separate `Bun.build`
  (`bin/build-storefront-dist.ts`) produces the release artifact. They can diverge
  (target, TS handling) and must be kept in sync by hand.
- **`tsc` only type-checks (`noEmit`)** — it never builds; emission is Bun (release)
  or Vite/esbuild (dev). The Vite path **strips types without type-checking**, so
  `tsc` is the only type gate — and it is **not part of `composer qa`** (qa = PHP
  `php -l` only). A type error passes qa and only fails at ZIP build / e2e.
- **No linter or formatter.** No ESLint / typescript-eslint / Prettier / Biome
  config exists. No `lint` / `format` scripts.
- **Mixed tool environments in one tsconfig.** A single `tsconfig.json` sets
  `"types":["node"]` and DOM libs and `include`s both `bin/**` (Bun/node scripts)
  and the browser storefront — so Node globals leak into browser code.
- **Stray `package-lock.json`** exists locally (gitignored) although Bun is the
  declared package manager — a confusing signal for contributors.
- `dist/` is **gitignored** and generated fresh for each ZIP (this part is fine).

### Typing quality (runtime `.ts`)

| Signal | Count | Meaning |
| --- | --- | --- |
| `UnknownRecord` (= `Record<string, any>`) | 83 | primary data-flow type; Store API/cart payloads are effectively untyped |
| raw `any` (34 in `shopware-client.ts`) | 44 | untyped API/DOM boundary propagates `any` downstream |
| `: any` annotations | 38 | explicit escape hatches |
| `Promise<any>` | 4 | core request methods (`storeApiRequest`, …) return untyped |
| `as any` casts | 0 | ✅ no unsafe casts |
| `@ts-ignore` / `@ts-expect-error` | 0 | ✅ no suppressed errors |

`strict` is on (good), but the code leans on `UnknownRecord`/`any` at every I/O
boundary instead of real domain types, so `strict` buys little. Tool inputs are
`input = {}` (untyped) then hand-validated, and the JSON Schema and the TS shape are
maintained separately (drift risk).

## What is wrong / strange (summary)

1. **JS-entry + TS-runtime split** and **two build pipelines** for one codebase —
   the unusual integration flagged in review.
2. **Type-checking is not enforced** in the main QA gate.
3. **No lint/format standard** — table stakes for an open-source repo.
4. **Weak typing at the boundaries** — `UnknownRecord`/`any` everywhere; no typed
   Store API / cart / tool-input models; schema ↔ type drift.
5. **One tsconfig for two runtimes** (node + browser).
6. **Structure**: god modules (`shopware-client.ts` ~1300, `runtime.ts` ~900),
   per-tool boilerplate, and the PHP↔TS document contract duplication (A1–A3) make
   the codebase hard for newcomers to navigate.

## Decision (target approach)

### Target state (at a glance)

**Module architecture** — thin tools over a typed domain boundary over a split
transport layer; one schema source feeds both TS types and tool JSON Schemas:

```mermaid
graph TB
    Main["main.ts (thin entry → PluginManager)"]
    subgraph Core["bootstrap + registry"]
        Boot["bootstrap.ts"]
        Registry["tool-registry.ts + shared tool factory"]
        Bridge["native-bridge.ts (document.modelContext)"]
    end
    subgraph Tools["tools/ — thin: schema + execute only"]
        Tsp["search-products"]
        Tgp["get-product"]
        Tgc["get-product-categories"]
        Tcart["cart tools"]
    end
    subgraph Domain["domain — typed"]
        Schema["schemas (zod)"]
        Models["normalizers → Product / Category / Cart models"]
    end
    subgraph Transport["transport"]
        SApi["store-api-client&lt;T&gt;()"]
        CApi["cart-client"]
        UiSync["cart-ui-sync"]
        Token["token-discovery"]
    end
    JsonSchema["tool inputSchema"]

    Main --> Boot --> Registry --> Tools
    Boot --> Bridge
    Tools --> Schema
    Schema -. generates .-> JsonSchema
    Schema -. infers .-> Tools
    Tools --> Transport
    Transport --> Models --> Domain
    any["any / unknown"] -.confined to.-> Schema
```

**CI & build** — `tsc`, lint, PHP QA and e2e are one required gate; `any` no longer
slips through, and the two emit paths stay explicit and separate:

```mermaid
graph LR
    Src["TS source<br/>(strict, typed boundaries)"]
    subgraph Gate["CI gate — required on every PR"]
        Tsc["tsc --noEmit"]
        Lint["eslint + prettier --check"]
        Qa["composer qa (php)"]
        E2E["playwright e2e"]
    end
    Dev["Shopware Vite/esbuild<br/>→ dev / theme"]
    Rel["Bun.build<br/>→ release ZIP (dist)"]
    Merge["merge / release"]

    Src --> Gate
    Src --> Dev
    Src --> Rel
    Tsc --> Merge
    Lint --> Merge
    Qa --> Merge
    E2E --> Merge
```

### Distribution & build model (the concrete solution)

> **Superseded by [ADR 0007](0007-build-and-packaging.md).** The standalone
> `Bun.build` bundler described below has been replaced by `shopware-cli` + npm; the
> distribution principle (ship a pre-built `dist`, keep it gitignored, `tsc` as a
> separate type gate) still holds.

Not "ship TS **or** JS" — **ship TS source and a pre-built JS bundle**. One source,
two emit channels, plus a separate type/quality gate:

```mermaid
graph LR
    Src["TS source<br/>src/.../storefront/src/*.ts"]
    Gate["tsc + eslint + prettier<br/>(checks only — no emit)"]
    Vite["Shopware Vite/esbuild<br/>(source deploys build themselves)"]
    Bun["Bun/esbuild bundler<br/>(standalone, no shop needed)"]
    Dist["dist/.../swag-web-mcp.js<br/>(gitignored, ZIP only)"]
    Zip["release ZIP<br/>(src + dist)"]

    Src --> Gate
    Src --> Vite
    Src --> Bun --> Dist --> Zip
```

**Why both channels are required:**

| Channel | What compiles the TS | What must be present |
| --- | --- | --- |
| Source deploy (git clone / composer project) | Shopware's Vite build during `bin/build-storefront.sh` / deploy | TS source only |
| ZIP / Store / Admin upload | nothing — the shop loads the **pre-built** JS directly and does **not** build | pre-built `dist/.../swag-web-mcp.js` **inside the ZIP** |

Production shops installing a ZIP usually have no Node/build toolchain, so the
compiled bundle **must** ship in the ZIP. The TS source is also in the ZIP but is
**not** transpiled on those shops.

**Fixed conventions:**
- Compiled path (Shopware kebab-case of the technical name):
  `src/Resources/app/storefront/dist/storefront/js/swag-web-mcp/swag-web-mcp.js`.
- `dist/` stays **gitignored**, regenerated per release, present **only in the ZIP**.
- The standalone bundle must match what Shopware expects: **IIFE, browser target,
  the exact path/filename, minified, registered via `window.PluginManager`** — this
  is what `bin/build-storefront-dist.ts` produces today; keep it, just document it.
- Producing `dist` with a standalone bundler (not Shopware's own build) is the
  deliberate trade-off for a standalone OSS repo with no shop in CI. Acceptable
  because the bundle is trivial (register a PluginManager plugin); the risk is
  transpile divergence from a real shop, mitigated by the e2e test (ADR 0002).

**Release chain (`bin/build-zip.sh`):**
`bun install` → `tsc` (type-check) → eslint/prettier (check) → `bun run build`
(emit `dist`) → package `src` + `dist` → zip.

### 1. Simplify the build/integration story
- Investigate a **`main.ts` entrypoint**. The Shopware storefront build here is
  Vite/esbuild-based and already compiles `.ts` (the Shopware core storefront is
  itself TypeScript), so a `.ts` entrypoint is very likely discovered; if so, drop
  the `main.js` shim and `allowJs`/`checkJs` so the whole runtime is TS.
- Treat **`tsc` as the type authority**, the Shopware Vite/esbuild build as the dev
  compiler, and **Bun.build only for the release ZIP**. Document this explicitly in
  the README/CONTRIBUTING so the two-compiler reality is intentional, not accidental.
- Add `declare`d Bun types (or `@types/bun`) to the build script instead of
  `declare const Bun: any`.

### 2. Enforce TypeScript in CI
- Add `bun run check` (tsc) to the QA gate so type errors fail CI, not only the ZIP
  build. Unify PHP + TS checks into one CI pipeline (composer qa + bun check + lint
  + e2e per [ADR 0002](0002-testing-strategy.md)).

### 3. Adopt lint + format
- **typescript-eslint** (flat config) + **Prettier** (or Biome as an all-in-one).
- Add `lint` / `format` scripts; run in CI; document in CONTRIBUTING.

### 4. Harden tsconfig
- Split configs: `tsconfig.node.json` (bin, Bun/node) vs a storefront config (DOM,
  no node types) with a shared base.
- Add beyond `strict`: `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitReturns`.

### 5. Replace boundary `any` with real types
- Introduce **domain types** for the Store API responses (product, category,
  navigation, cart) and normalize raw payloads into them at the client boundary, so
  `any`/`UnknownRecord` stays confined to the parse layer.
- Consider **zod** (or valibot) for runtime validation of external payloads and tool
  inputs, deriving TS types from the schema — one source of truth for validation +
  type. This also lets tool **JSON Schemas be generated from the same schema**,
  killing the schema↔type drift (and the earlier top-level `oneOf` class of bugs).
- Type the core request methods (`storeApiRequest<T>()`), removing `Promise<any>`.

### 6. Structure for readability (open-source ergonomics)

The runtime follows a small, explicit layering with **one-way dependencies**
(`tools → adapter → transport / domain`). This is the canonical convention; the
concrete decomposition steps and current line counts live in
[Spec 0002](../specs/0002-typescript-foundation-implementation-plan.md).

| Layer | Answers | Knows about | Must NOT |
| --- | --- | --- | --- |
| **transport/** | "how to make the HTTP call" | fetch, headers, CSRF/token, endpoint paths, response parsing | know what a product or cart *means*; hold session state |
| **domain/** | "what the data means" | raw payload shapes → typed models (`ProductSummary`, `CartSummary`, category nodes) | do any I/O / touch the DOM |
| **adapter** (`shopware-client.ts`) | "do a commerce operation" | which backend per op, session/context, combining transport + domain | build JSON schemas or format agent text (that's `tools/`) |
| **tools/** | the MCP contract for the agent | zod schema + description + execute | make HTTP calls or normalize payloads directly |
| **model-context/** | MCP plumbing | register/unregister, native `document.modelContext` bridge | know about commerce |

**Why one adapter, not two classes:** the Store-API reads and the cart writes share
`baseUrl`, `contextToken`, and `resolveProductId`. Splitting `ShopwareClient` into
two classes would just thread that shared state around, so the *backends* are
separated in `transport/` (function modules) while `ShopwareClient` stays a single
facade that holds context and orchestrates.

Supporting decisions:
- A **shared tool factory** (`defineTool`) + typed `productSelector` schema removes
  per-tool boilerplate (A3).
- Tool discovery has a **single source of truth** — the live `document.modelContext`
  registry; there is no static document (see [ADR 0006](0006-tool-discovery-contract.md), formerly A1).
- A short **CONTRIBUTING.md + architecture note** makes the layering, the build
  paths, and the conventions discoverable.

## Implementation status

The foundation is delivered on the `refactor/typescript-foundation` branch: ESLint +
Prettier + a CI quality gate; a `main.ts` entrypoint (Shopware resolves `main.ts`
ahead of `main.js`, so the JS shim was removed); the `defineTool` + zod tool factory
with safety hints; the `shopware-client.ts` split into `transport/` + `domain/` +
`cart-ui-sync`; the `runtime.ts` model-context registry extracted; and the
browser/node tsconfig split with the stricter flags.

The former "single-source WebMCP document" work was overtaken by events: rather than
making one side authoritative, the bespoke document was **removed entirely** — see
[ADR 0006](0006-tool-discovery-contract.md). Full domain-type coverage (replacing the
remaining parse-boundary `any`) and the final module tidy remain follow-ups, tracked
step-by-step in [Spec 0002](../specs/0002-typescript-foundation-implementation-plan.md).

## Non-goals

- Rewriting working runtime behavior. This is about types, structure, and tooling,
  not changing what the tools do.
- Adopting a heavy framework or bundler. Keep the vanilla-TS + Shopware storefront
  integration; only make it explicit and type-safe.

## Consequences

- **Positive:** readable, contributor-friendly codebase; enforced type safety;
  consistent style; boundary types that make the Store API contract explicit;
  schema/type drift eliminated.
- **Cost:** upfront refactor (typing the Store API surface, splitting modules, wiring
  lint/CI). Best done incrementally: (1) CI + lint + tsconfig, (2) tool factory +
  schema/type unification, (3) module split, (4) domain types.
- **Risk:** introducing zod/domain types touches the client boundary broadly;
  guard with the [ADR 0002](0002-testing-strategy.md) test pyramid before/after.

## Verification

- CI runs `tsc --noEmit`, ESLint, Prettier check, `composer qa`, and the e2e suite,
  all green, on every PR.
- `grep` counts for boundary `any` / `UnknownRecord` trend to near-zero outside the
  parse/validation layer.
- A new contributor can locate "where a tool is defined", "where the Store API is
  called", and "how to add a tool" from the CONTRIBUTING/architecture note alone.
