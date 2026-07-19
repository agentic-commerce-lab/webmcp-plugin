# Shopware WebMCP Plugin

[WebMCP](https://github.com/webmachinelearning/webmcp)
support for Shopware 6.
AI-capable clients can do agentic product discovery, category browsing, and cart
operations in context of a browser session. 

> **Status: research preview.** This plugin is experimental and not intended for
> production use. Use it only in controlled test or development environments, and
> complete your normal security, privacy, and QA review before any production
> rollout.

## What Is WebMCP?

WebMCP is a browser-facing model context pattern that lets a website publish
structured context and callable tools for AI-capable clients. Instead of forcing
an assistant to infer product, category, and cart state from rendered HTML, a
storefront can expose explicit tool contracts with validated inputs and
structured outputs.

## What This Plugin Does

When enabled, AI-capable browsers and assistants can interact with a Shopware
storefront through structured catalog and cart tools: search products, inspect product details, browse categories, read the current cart, and prepare cart changes — all as explicit, bounded capabilities with validated inputs and structured outputs.

It does **not** handle checkout, payment, private backend operations, or
privileged merchant workflows.

## Development

You can checkout this plugin to `custom/plugins/SwagWebMcp` of an existing installation or use ephemeral Shopware instances provided by dockware. 

For this you only need [Bun](https://bun.sh) and Docker.

### 1. Install dependencies

```sh
bun install
```

### 2. Boot a local shop

A full, ephemeral Shopware (web + MySQL + Adminer + MailCatcher) runs in a single [Dockware](https://dockware.io) container with this plugin bind-mounted into it.

```sh
cp .env.example .env   # then adjust ports if any are already taken
bun run shop:up        # boot the shop (first run pulls the image)
bun run shop:deploy    # transpile the TS runtime and install the plugin
```

Open <http://localhost:8000>:

- Storefront — `http://localhost:8000`
- Admin — `http://localhost:8000/admin` (`admin` / `shopware`)
- Adminer — `http://localhost:8000/adminer.php` (`root` / `root`, db `shopware`)
- Mail — `http://localhost:1080`

Ports and the Shopware version are read from `.env` (see `.env.example`).

### 3. The dev loop

Edit code, then re-run:

```sh
bun run shop:deploy
```

PHP changes are picked up live from the mounted source; storefront TypeScript changes need the `shop:deploy` rebuild.

### Commands

| Command                 | What it does                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `bun run shop:up`       | Start the shop and align its storefront domain with the port    |
| `bun run shop:deploy`   | `bun run build` + refresh, install/activate, compile theme      |
| `bun run shop:test`     | Ensure the shop is up + deployed, then run the e2e tests        |
| `bun run shop:down`     | Stop and remove the shop container                              |
| `bun run shop:restart`  | Restart the shop container                                      |
| `bun run shop:logs`     | Follow the shop logs                                            |
| `bun run shop:shell`    | Open a shell inside the shop container                          |
| `bun run shop:open`     | Print the shop, admin, Adminer, and mail URLs                   |
| `bun run build`         | Transpile the storefront TS runtime to the release `dist` asset |
| `bun run check`         | Type-check the TypeScript (`tsc --noEmit`)                      |
| `bun run lint`          | Lint with ESLint (`lint:fix` to autofix)                        |
| `bun run format`        | Format with Prettier (`format:check` to verify only)           |
| `bun run test:e2e`      | Run the Playwright end-to-end tests against the running shop    |

### Testing

The end-to-end tests (Playwright) run against the dev shop, which is also the
default `baseURL` (`http://localhost:8000`):

```sh
bunx playwright install chromium   # once
bun run shop:test                  # boot the shop, deploy the plugin, run the tests
```

If the shop is already up and you only changed a test, `bun run test:e2e` is
enough. Target a different shop with `SHOPWARE_BASE_URL=... bun run test:e2e`.

For native browser testing, follow Chrome's
[WebMCP setup guide](https://developer.chrome.com/docs/ai/webmcp), enable
`chrome://flags/#enable-webmcp-testing`, and relaunch Chrome. Then inspect the runtime from the storefront console:

```js
window.SwagWebMcp; // runtime config + loaded state
document.modelContext.getTools(); // registered WebMCP tools
```

### Architecture

See the [Architecture Overview](docs/Architecture.md) for how the plugin is put
together, and [docs/](docs/README.md) for the ADRs and specs.

### Building an installable ZIP

```sh
docker compose run --rm qa bin/build-zip.sh
```

## Installing Into an Existing Shopware

Download the latest release and upload it in Shopware Admin (Extensions → My
extensions → Upload extension), then activate it:

<https://github.com/agentic-commerce-lab/web-mcp-plugin/releases/download/latest-main/SwagWebMcp.zip>


```sh
bun install && bun run build
bin/console plugin:refresh
bin/console plugin:install --activate SwagWebMcp   # or: plugin:update SwagWebMcp
bin/console theme:compile && bin/console assets:install && bin/console cache:clear
```

After installing, enable and configure the plugin in Shopware Admin.

## Configuration

Shopware renders these settings in the plugin configuration screen in the Admin panel:

<img src="docs/admin-configuration.svg" alt="Shopware Admin WebMCP configuration screen" width="760">

- `enabled`: enables the public WebMCP browser tools.
- `context`: human-readable context for the WebMCP runtime.
- `searchProductsToolEnabled`: enables the product search `document.modelContext` tool.
- `getProductToolEnabled`: enables the product detail `document.modelContext` tool.
- `getProductCategoriesToolEnabled`: enables the product category `document.modelContext` tool.
- `getCartToolEnabled`: enables the cart read `document.modelContext` tool.
- `addToCartToolEnabled`: enables the cart mutation `document.modelContext` tool.
- `updateLineItemToolEnabled`: enables the cart line item update `document.modelContext` tool (quantity `0` removes).
- `getSalesChannelContextToolEnabled`: enables the sales channel context `document.modelContext` tool.
- `navigateToolEnabled`: enables the storefront navigation `document.modelContext` tool.

## Tool Reference

All tools return WebMCP-style results with `content` text and `structuredContent`
data. Product and category lookups use the Shopware Store API with customer
context. Cart reads/writes and the sales channel context use the plugin's own
same-origin storefront JSON endpoints (server-side `CartService`), and cart
writes request best-effort storefront cart UI refreshes after success.

| Tool | Input | Structured output |
| --- | --- | --- |
| `shopware_webmcp_search_products` | Optional `query`; optional `limit` from `1` to `20`, default `5`. | `query`, `count`, `total`, `products`. |
| `shopware_webmcp_get_product` | Exactly one of `id`, `sku`, or same-origin product `url`. | `lookup`, `product`. |
| `shopware_webmcp_get_product_categories` | Optional `scope`: `tree` or `product`; for `product` scope exactly one of `id`, `sku`, or same-origin `url` (any of them implies `product` scope). | `lookup`, `scope`, `source` (`store-api`), `sourceUrl`, `count`, `activeCategoryIds`, `categories`, `tree`. Categories carry real Shopware ids, names, SEO urls, and `parentId`. |
| `shopware_webmcp_get_cart` | No input properties. | `cart`. |
| `shopware_webmcp_add_to_cart` | Exactly one of `id`, `sku`, or same-origin product `url`; optional `quantity` from `1` to `100`, default `1`; optional `showCartOverlay` (default `false`) to open the storefront cart overlay for shopper feedback. | `added`, `cart`. |
| `shopware_webmcp_update_line_item` | Exactly one of `lineItemId`, `id`, `sku`, or same-origin product `url`; required `quantity` from `0` to `100`. Quantity `0` removes the line item. | `updated`, `cart`, or `skipped` with `reason`. |
| `shopware_webmcp_get_sales_channel_context` | No input properties. | `salesChannelContext` (sales channel, language, currency, customer group, country, tax mode, login state). |
| `shopware_webmcp_navigate` | Same-origin storefront `url` (or path) to open. | `navigatedTo`. |

## Security & Limits

- Do not expose private backend credentials in storefront code or plugin config.
- The Store API access key is a storefront value used by Shopware browser clients.
- Cart read and mutation requests use same-origin storefront session cookies.
- CSRF tokens are read from the storefront when available and sent with cart mutation requests.
- Tool inputs are validated and normalized before Store API or storefront cart requests are made.
- Do not log secrets, tokens, credentials, storefront session identifiers, CSRF tokens, or raw sensitive user/cart data.
- Normalize and constrain URLs, selectors, HTTP methods, quantities, product identifiers, and other user-controllable values before emitting or using them.

Known limitations:

- The plugin depends on storefront context; `/webmcp/cart` returns `400` when a request does not receive a Shopware sales channel context. Test from a storefront route rather than an admin or CLI context.
- If product tools fail with `401` or `403`, the storefront page may not include a valid sales channel Store API access key or the current sales channel may not allow Store API product access.
- If `get_cart` returns `404`, the plugin or `getCartToolEnabled` may be disabled.
- If cart mutation tools update the session but the storefront UI does not refresh, the active theme may not register Shopware's standard cart widget or offcanvas cart plugins, or may replace the standard checkout wrapper markup. The runtime requests best-effort header cart refreshes, updates open cart sidebars in place, and refreshes the rendered cart page fragment when the shopper is already on `/checkout/cart`.
- Browser-side native tool registration depends on Chrome's WebMCP testing support; `document.modelContext` remains available for manual console testing.

## Contributing

Feedback and contributions are welcome. If you test this plugin, please share
what you learn with the Agentic Commerce Lab by opening a GitHub issue. Pull
requests are welcome, especially for bug fixes, documentation, storefront
compatibility notes, and small enhancements. For larger changes, please open an
issue first so we can discuss the direction.

## License

See [LICENSE](LICENSE).
