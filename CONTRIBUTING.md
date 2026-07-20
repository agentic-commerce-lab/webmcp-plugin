# Contributing

Thanks for helping improve the Shopware WebMCP plugin. This guide covers the
storefront TypeScript architecture, the build model, and the local checks.

## Prerequisites

- **Node.js** (LTS) + **npm** (package manager + test runner).
- **[shopware-cli](https://sw-cli.fos.gg/install/)** for the storefront build and the installable ZIP.
- **Docker** for PHP QA (`docker compose run --rm qa`) and the local dev shop.
- PHP/Composer are optional locally; QA runs in Docker.

```sh
npm install
```

## Local checks (run before every PR)

| Command | What it does |
| --- | --- |
| `npm run check` | Type-checks the storefront (`tsconfig.json`) and the Node scripts (`tsconfig.node.json`). |
| `npm run lint` | ESLint (flat config, typescript-eslint). `npm run lint:fix` to autofix. |
| `npm run format:check` | Prettier check. `npm run format` to write. |
| `npm run build` | Builds the storefront asset to `dist` via `shopware-cli` (Shopware's own build). |
| `npm run test:e2e` | Playwright integration test against an already-running shop (see below). |
| `npm run shop:deploy` | Build the asset (webpack, inside the running shop, ~15–20 s) + (re)install the plugin. |
| `npm run shop:test` | Boot the Dockware dev shop, deploy the plugin, then run `test:e2e`. |

CI runs `check` + `lint` + `format:check` (the `quality` job) and the Playwright
integration test on every pull request.

## Build & distribution model

TypeScript never ships to the browser as-is; it is always compiled — see
[ADR 0007](docs/adr/0007-build-and-packaging.md):

- **Source install** (git clone / composer project): Shopware's own storefront build
  (Webpack) compiles the plugin's `.ts` during the normal storefront build.
- **ZIP / Store / Admin upload**: the shop does not build assets, so a pre-built
  bundle must ship inside the ZIP at
  `src/Resources/app/storefront/dist/storefront/js/swag-web-mcp/swag-web-mcp.js`.
  `dist/` is gitignored and produced fresh by `shopware-cli` — locally via
  `npm run build` / `bin/build-zip.sh`, in CI via `shopware/github-actions/build-zip`.

Type-checking is a separate gate: the storefront build strips types without checking
them, so `tsc` (via `npm run check`) is the authority.

## Architecture

See [Architecture Overview](docs/Architecture.md) for the full picture.

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
([ADR 0002](docs/adr/0002-testing-strategy.md)). The simplest path uses the
local Dockware dev shop (see the README "Development" section):

```sh
npx playwright install --with-deps chromium   # once
npm run shop:test                              # boot + deploy + test
```

`npm run shop:test` ensures the shop is up (`shop:up`) and the current code is
deployed (`shop:deploy`), then runs the tests. If the shop is already running and
you only changed a test, `npm run test:e2e` is enough. To target a different shop,
set `SHOPWARE_BASE_URL` (defaults to `http://localhost:8000`, the dev shop).

## PHP backend

PHP lives under `src/WebMcp` (endpoints, config provider, cart payload builder).
QA is `composer qa` (run via `docker compose run --rm qa`), which runs `php -l`
syntax linting, **PHPStan** (level 8, config in `phpstan.neon.dist`), and
**PHP-CS-Fixer** in check mode (`.php-cs-fixer.dist.php`). Run `composer cs-fix`
to apply code-style fixes.
