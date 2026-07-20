# ADR 0007 — Build & packaging: shopware-cli + npm (retire Bun)

Date: 2026-07-20
Status: Accepted
Relates to: [ADR 0003 — TypeScript architecture](0003-typescript-architecture.md)
(supersedes its build-model decision) · [ADR 0002 — Testing Strategy](0002-testing-strategy.md)

> **SSOT for how the storefront asset is built and how the plugin ZIP is produced.**
> Supersedes the "ship a standalone `Bun.build` bundle" decision in ADR 0003.

## Goal

Build the storefront asset and package the plugin the **idiomatic Shopware way**, and
retire the bespoke Bun bundler — without committing compiled artifacts.

## Context

- A Shopware shop **never transpiles on install**. Store/ZIP installs load a
  pre-built `dist/.../swag-web-mcp.js` directly; only a Node-based build step
  (Shopware's storefront Webpack build) ever compiles the TS. So a build must happen
  **before** distribution regardless.
- ADR 0003 solved this with a standalone `Bun.build` (`bin/build-storefront-dist.ts`)
  to avoid a Shopware dependency in CI. This works but is a **second, divergent
  bundler** next to Shopware's own — the "two compilers" smell that ADR flagged.
- Shopware's own reference (`shopware/SwagCommercial`) packages plugins in CI with
  **`shopware-cli extension zip --release`** (via `shopware/github-actions/build-zip`),
  not by committing `dist` and not with a bespoke bundler.
- **Verified (2026-07-20)** in the Dockware container with real npm: `shopware-cli
  extension zip` installs our deps cleanly, compiles `main.ts` via Webpack to the
  correct path (`dist/storefront/js/swag-web-mcp/swag-web-mcp.js` + lazy chunk), and
  produces a valid `SwagWebMcp.zip` (228 K). The only missing piece was a plugin icon.
  - Earlier `ERESOLVE`/`ETARGET` npm failures were an artifact of a broken **local**
    Node (Zed's bundled npm), **not** a real incompatibility.

## Decisions

- **Package with `shopware-cli`.** CI builds the ZIP via
  `shopware/github-actions/build-zip@main` (= `shopware-cli extension zip --release`).
  Rationale: idiomatic, shop-true output, ships `extension validate`, no bespoke bundler.
- **Migrate the JS toolchain Bun → npm.** One ecosystem, matching `shopware-cli`
  (npm-based). `package-lock.json` replaces `bun.lock`; `npm run …` replaces `bun run …`.
  Rationale: removes the Bun↔npm friction and the parallel toolchain.
- **Retire `bin/build-storefront-dist.ts` and Bun.** `shopware-cli` produces `dist` in
  **CI/release**. **Local dev** builds with Shopware's own Webpack *inside the running
  dev shop* (`shop:deploy`, ~15–20 s — the build env is warm there, vs ~70 s for a
  standalone `shopware-cli` build). No host `shopware-cli` needed for day-to-day dev.
- **Add `src/Resources/config/plugin.png`.** Required by `shopware-cli` (and the Store).
- **`dist` stays gitignored — no committed artifacts.** Rationale: Shopware doesn't
  commit them either; avoids unreviewable diffs and source↔bundle drift.
- **e2e tests the shipped bundle.** The test job builds `dist` with `shopware-cli
  extension build` (not a separate bundler), so we test exactly what we ship.
- **Packaging hygiene** via `.shopware-extension.yml`: `build.zip.assets.npm_strict:
  true` (build installs only the runtime dep `zod`) and `pack.excludes` for dev files.

## Non-Goals

- Committing `dist` into git.
- Changing any runtime behavior — this is build/packaging only.
- The full `shopware/shopware` checkout that `SwagCommercial` needs (that is for admin
  imports from the platform; our storefront-only plugin imports nothing from Shopware,
  only `window.PluginManager` globals, so plain `shopware-cli extension build/zip` suffices).

## Risks

- **Slower build than the old `Bun.build`.** `Bun.build` was instant. Locally,
  `shop:deploy` builds with Shopware's own Webpack *inside the warm dev shop* in
  ~15–20 s (vs ~70 s for a standalone `shopware-cli` build, which rebuilds its
  environment each run). Acceptable for the deploy loop; the standalone `shopware-cli`
  cost only applies to CI/release, where it is fine.
- **Node + `shopware-cli` dependency in CI.** Accepted: it is the idiomatic path and
  removes the self-maintained bundler; guarded by the e2e test (ADR 0002).

## Verification

- `shopware-cli extension zip` produces a valid `SwagWebMcp.zip` containing the
  compiled `dist` (verified 2026-07-20).
- CI green: `npm run check`/`lint`/`format:check`, PHP QA, e2e against a real shop, and
  the `build-zip` job.
- Fresh ZIP install serves `swag-web-mcp.js` and `document.modelContext` works (e2e).
