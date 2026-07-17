# Contributing

Thanks for helping improve the Shopware WebMCP plugin. This guide covers the
storefront TypeScript architecture, the build model, and the local checks.

## Prerequisites

- **Bun** `1.3.14` (package manager + release build + test runner).
- **Docker** for QA and the installable ZIP (`docker compose run --rm qa`).
- PHP/Composer are optional locally; QA runs in Docker.

```sh
bun install
```

## Local checks (run before every PR)

| Command | What it does |
| --- | --- |
| `bun run check` | Type-checks the storefront (`tsconfig.json`) and the Node scripts (`tsconfig.node.json`). |
| `bun run lint` | ESLint (flat config, typescript-eslint). `bun run lint:fix` to autofix. |
| `bun run format:check` | Prettier check. `bun run format` to write. |
| `bun run build` | Bundles the release storefront asset with Bun. |
| `bun run test:e2e` | Playwright integration test against a running Shopware (see below). |

CI runs `check` + `lint` + `format:check` (the `quality` job) and the Playwright
integration test on every pull request.

## Build & distribution model

TypeScript never ships to the browser as-is; it is always compiled. There are two
channels — see [ADR 0004](docs/adr/2026-07-17-typescript-architecture.md):

- **Source install** (git clone / composer project): Shopware's own Vite/esbuild
  storefront build compiles the plugin's `.ts` during the normal storefront build.
- **ZIP / Store / Admin upload**: the shop does not build assets, so a pre-built
  bundle must ship inside the ZIP at
  `src/Resources/app/storefront/dist/storefront/js/swag-web-mcp/swag-web-mcp.js`.
  `dist/` is gitignored and produced fresh by `bun run build` (and by
  `bin/build-zip.sh`).

Type-checking is a separate gate: neither Vite nor Bun type-check, so `tsc` (via
`bun run check`) is the authority.

## Storefront architecture

Runtime lives under `src/Resources/app/storefront/src/`:

```
main.ts                      entrypoint (registers the PluginManager plugin)
webmcp-model-context/
  runtime.ts                 bootstrap, config, document assembly, tool registration
  model-context-registry.ts  document.modelContext registry + native bridge
  cart-ui-sync.ts            best-effort storefront cart-UI refresh after mutations
  shopware-client.ts         facade over the transport + domain modules
  transport/                 token-discovery · http · paths
  domain/                    product · category · cart (payload normalizers)
  tools/
    define-tool.ts           the tool factory (zod schema -> validator + JSON Schema)
    schemas.ts               shared zod selectors, quantity, bounds
    *.tool.ts                one file per tool: schema + execute, nothing else
    storefront-tool.utils.ts small shared helpers
```

See [ADR 0001](docs/adr/2026-07-17-architecture-overview.md) for the full picture.

## Adding or changing a tool

1. Add a `*.tool.ts` file that calls `defineTool({ name, title, description, input,
   annotations, execute })`.
2. `input` is a **zod** schema built from `tools/schemas.ts` (e.g.
   `productSelectorShape` + `.refine(hasExactlyOne, ...)`). The factory derives both
   the runtime validator and the advertised JSON Schema from it — never hand-write a
   JSON Schema, and never add a top-level `oneOf`/`anyOf` (function-calling APIs
   reject them; zod refinements avoid this by construction).
3. Set `annotations`: `readOnlyHint: true` for read-only tools;
   `untrustedContentHint: true` when the result contains product/cart text.
4. Register the tool in `runtime.ts`, add an admin toggle in
   `src/Resources/config/config.xml`, wire the toggle in
   `src/Resources/views/storefront/layout/meta.html.twig`, and add a row to the
   README tool table.
5. Keep `structuredContent` shapes stable unless you intend a contract change.

## Running the integration test locally

The Playwright test drives `document.modelContext` against a real storefront
([ADR 0003](docs/adr/2026-07-17-testing-strategy.md)). Point it at a running shop
(env `SHOPWARE_BASE_URL`) with the plugin installed and activated, then:

```sh
bunx playwright install --with-deps chromium
bun run test:e2e
```

## PHP backend

PHP lives under `src/WebMcp` (endpoints, config provider, cart payload builder).
QA is `composer qa` (run via `docker compose run --rm qa`).
