# Shopware WebMCP Plugin

A Shopware 6 plugin that publishes a WebMCP side-car document for a storefront
and registers browser-side WebMCP tools through `document.modelContext` and,
when available, native `navigator.modelContext` for product discovery, category
discovery, and cart operations.

The package follows the conventional Shopware plugin structure:

- `composer.json` declares the Shopware plugin package and autoloading.
- `src/SwagWebMcp.php` is the plugin class.
- `src/Resources/config` contains Shopware service, route, and plugin configuration.
- `src/WebMcp` contains the document controller, config reader, and cart payload builder.
- `src/Resources/views` injects the storefront WebMCP configuration and fallback runtime.
- `src/Resources/app/storefront/src` contains the Shopware storefront JavaScript plugin.
- `src/Resources/public` contains the browser runtime used by both the storefront plugin and fallback script.

## Research Preview

> **Status: Research preview.** This plugin is for experimenting with WebMCP in
> Shopware storefronts. Treat it as an integration prototype: validate behavior
> in your own storefront, review the exposed tool surface, and keep production
> rollout decisions tied to your security and QA process.

## What Is WebMCP?

WebMCP is a browser-facing model context pattern that lets a website publish
structured context and callable tools for AI-capable clients. Instead of forcing
an assistant to infer product, category, and cart state from rendered HTML, a
storefront can expose explicit tool contracts with validated inputs and
structured outputs.

In this plugin, the WebMCP document is available through `/webmcp.wmcp`, and
the browser runtime exposes the same model context surface through
`document.webMcp`, `document.modelContext`, `window.SwagWebMcp`, and native
`navigator.modelContext` registration when supported by Chrome testing builds.

## Why It Matters

For Shopware merchants, WebMCP can make storefronts easier for AI assistants to
understand and operate without changing the shopper-facing theme. Product search,
product detail lookup, category discovery, and cart actions become explicit,
bounded capabilities rather than fragile DOM scraping tasks.

For the Shopware community, this plugin provides a small, inspectable reference
for exploring how WebMCP-style tools can fit into existing storefront,
configuration, session, and Store API boundaries.

## What It Does

When enabled, the plugin exposes:

- `GET /webmcp.wmcp`: returns the WebMCP side-car document as `application/webmcp+json`.
- `GET /webmcp/cart`: returns the current shopper cart as JSON for the browser-side `get_cart` tool.
- Browser-side WebMCP state at `document.webMcp`.
- Browser-side tool helpers at `document.modelContext`.
- Native browser tool registration through `navigator.modelContext` when available.
- A storefront runtime namespace at `window.SwagWebMcp`.
- Native-safe tool names in the `shopware_webmcp_*` family.
- Shopware Admin configuration for enabling the plugin and individual tools.

Endpoint behavior:

- `/webmcp.wmcp` returns `404` when the plugin is disabled.
- `/webmcp.wmcp` sends `Cache-Control: public, max-age=300`.
- `/webmcp/cart` returns `404` when the plugin or `get_cart` tool is disabled.
- `/webmcp/cart` returns `400` when Shopware cannot provide a sales channel context.
- `/webmcp/cart` sends `Cache-Control: private, no-store`.
- Cart data is session-bound through the current storefront shopper context.

The storefront runtime uses Shopware's JavaScript entrypoint at
`src/Resources/app/storefront/src/main.js`. It registers
`SwagWebMcpModelContext` through `window.PluginManager`, and Twig passes
Shopware Admin settings through data options on the bound config element.

Twig also passes the current sales channel's Store API access key so product
lookup tools can call Shopware's Store API. Cart mutation tools use same-origin
storefront cart endpoints with the shopper's session cookies so storefront UI
refreshes see the same cart. Twig also loads the same browser runtime from
`src/Resources/public/webmcp-model-context.js` so tools still initialize if the
active storefront bundle has not included the plugin entrypoint.

When the runtime initializes, it builds a browser-side WebMCP document at
`document.webMcp`, registers enabled tools with Chrome's native
`navigator.modelContext` API when available, and keeps a fallback
`document.modelContext` helper for manual console testing.

Bootstrap is idempotent; repeated calls update existing WebMCP tools rather
than adding duplicate entries.

## Not Included

This plugin deliberately does not:

- Add private backend credentials or privileged API tokens to storefront code.
- Replace Shopware's Store API, storefront cart routes, session model, or theme system.
- Persist shopper data outside the normal Shopware storefront context.
- Guarantee production readiness for every storefront, theme, or browser build.
- Add a frontend package manager, bundler, or browser dependency.
- Attempt to solve every possible merchant workflow through WebMCP tools.

## Demo Video

Demo video placeholder. A walkthrough video will be added here later.

## Benchmark

### DOM Scraping vs WebMCP Tools

This repository is intended to support a comparison between browser automation
that scrapes rendered DOM and browser automation that calls explicit WebMCP
tools. A benchmark write-up can be added here once measurements are available.

Suggested comparison points:

- Product lookup accuracy from listing and detail pages.
- Cart mutation reliability across theme changes.
- Amount of prompt or automation code needed to complete the same task.
- Error handling clarity when a product, SKU, category, or line item is missing.
- Resistance to visual markup changes that do not change storefront behavior.

## Requirements

- Shopware 6 storefront plugin installation.
- PHP `^8.1`, matching the Composer platform configuration.
- Docker for the repository QA workflow.
- Host PHP and Composer are optional for local development because QA runs in Docker.

## Installation

Install this repository as a Shopware platform plugin:

    mkdir -p custom/plugins
    cp -R <repository-path> custom/plugins/SwagWebMcp
    bin/console plugin:refresh
    bin/console plugin:install --activate SwagWebMcp
    bin/console assets:install
    bin/console theme:compile
    bin/console cache:clear

After installation, enable or configure the plugin in Shopware Admin under the
plugin configuration screen.

## Use & Test

For native WebMCP testing, follow Chrome's
[WebMCP setup guide](https://developer.chrome.com/docs/ai/webmcp), enable
`chrome://flags/#enable-webmcp-testing`, and relaunch Chrome. To inspect native
tool registration, install the
[WebMCP Model Context Tool Inspector](https://chromewebstore.google.com/detail/webmcp-model-context-tool/gbpdfapgefenggkahomfgkhfehlcenpd)
Chrome extension.

Open a storefront page in Chrome and check the WebMCP runtime in the browser
console:

```js
document.webMcp.getDocument()
document.modelContext.getTools()
```

Replace placeholder values such as `<product-sku>` and `<cart-line-item-id>`
with values from your storefront.

Call product tools:

```js
await document.modelContext.callTool('shopware_webmcp_search_products', {})
const searchResult = await document.modelContext.callTool(
    'shopware_webmcp_search_products',
    { query: '<search-term>', limit: 3 },
)

await document.modelContext.callTool('shopware_webmcp_get_product', { sku: '<product-sku>' })
await document.modelContext.callTool('shopware_webmcp_get_product', {
    id: searchResult.structuredContent.products[0].id,
})

await document.modelContext.callTool('shopware_webmcp_get_product_categories', {})
await document.modelContext.callTool('shopware_webmcp_get_product_categories', {
    sku: '<product-sku>',
})
```

Call cart tools:

```js
await document.modelContext.callTool('shopware_webmcp_get_cart', {})
await document.modelContext.callTool('shopware_webmcp_add_to_cart', {
    sku: '<product-sku>',
    quantity: 1,
})

const cartResult = await document.modelContext.callTool('shopware_webmcp_get_cart', {})
await document.modelContext.callTool('shopware_webmcp_update_line_item', {
    lineItemId: cartResult.structuredContent.cart.lineItems[0].id,
    quantity: 2,
})
await document.modelContext.callTool('shopware_webmcp_update_line_item', {
    sku: '<product-sku>',
    quantity: 0,
})
await document.modelContext.callTool('shopware_webmcp_remove_from_cart', {
    lineItemId: '<cart-line-item-id>',
    quantity: 1,
})
```

Helper methods are also exposed on `window.SwagWebMcp`:

```js
window.SwagWebMcp.registerConfiguredTools()
window.SwagWebMcp.registerSearchProductsTool()
window.SwagWebMcp.registerGetProductTool()
window.SwagWebMcp.registerGetProductCategoriesTool()
window.SwagWebMcp.registerGetCartTool()
window.SwagWebMcp.registerAddToCartTool()
window.SwagWebMcp.registerUpdateLineItemTool()
window.SwagWebMcp.registerRemoveFromCartTool()
```

If the WebMCP Model Context Tool Inspector shows no tools, confirm Chrome's
`WebMCP for testing` flag is enabled and then check:

```js
window.SwagWebMcp?.loaded
document.modelContext?.getTools?.().map((tool) => tool.name)
navigator.modelContextTesting?.listTools?.()
```

The inspector reads the native registry, so `navigator.modelContextTesting`
should list the same native-safe tool names returned by
`document.modelContext.getTools()`, such as `shopware_webmcp_search_products`.

If `window.SwagWebMcp` is undefined, check the page source for
`data-swag-web-mcp-model-context` and `webmcp-model-context.js`. If either is
missing, rerun:

    bin/console assets:install
    bin/console theme:compile
    bin/console cache:clear

## Tool Reference

All tools return WebMCP-style results with `content` text and
`structuredContent` data. Product lookup tools use the Shopware Store API with
customer context. Cart mutation tools use storefront cart routes and publish a
cart update event after successful mutations.

| Tool | Input | Structured output |
| --- | --- | --- |
| `shopware_webmcp_search_products` | Optional `query`; optional `limit` from `1` to `20`, default `5`. | `query`, `count`, `total`, `products`. |
| `shopware_webmcp_get_product` | Exactly one of `id`, `sku`, or same-origin product `url`. | `lookup`, `product`. |
| `shopware_webmcp_get_product_categories` | Optional `scope`: `tree` or `product`; optional `sku` or same-origin `url`. `sku` implies `product` scope. | `lookup`, `scope`, `source`, `sourceUrl`, `count`, `activeCategoryIds`, `categories`, `tree`. |
| `shopware_webmcp_get_cart` | No input properties. | `cart`. |
| `shopware_webmcp_add_to_cart` | Exactly one of `id`, `sku`, or same-origin product `url`; optional `quantity` from `1` to `100`, default `1`. | `added`, `cart`. |
| `shopware_webmcp_update_line_item` | Exactly one of `lineItemId`, `id`, `sku`, or same-origin product `url`; required `quantity` from `0` to `100`. Quantity `0` removes the line item. | `updated`, `cart`, or `skipped` with `reason`. |
| `shopware_webmcp_remove_from_cart` | Exactly one of `lineItemId`, `id`, `sku`, or same-origin product `url`; optional `quantity` from `1` to `100`, default `1`. | `removed`, `cart`. |

Product URLs must be same-origin storefront URLs or paths. `/detail/{id}` URLs
can be resolved directly; SKU lookups resolve through Store API product search.

The runtime dispatches these document events:

- `webmcp:document-ready`: fired when the WebMCP document is available.
- `webmcp:model-context-ready`: fired when a tool is registered or removed.
- `webmcp:cart-updated`: fired after a successful cart mutation.

The runtime also listens for these document events and attempts to bootstrap
again when they are dispatched:

- `webmcp:document-request`
- `webmcp:model-context-request`

## Configuration

Shopware renders these settings in the plugin configuration screen in the Admin
panel:

- `enabled`: enables the public WebMCP document endpoint and browser tools.
- `context`: human-readable context for the WebMCP document.
- `staticElementsJson`: optional JSON for additional WebMCP element definitions.
- `searchProductsToolEnabled`: enables the product search `document.modelContext` tool.
- `getProductToolEnabled`: enables the product detail `document.modelContext` tool.
- `getProductCategoriesToolEnabled`: enables the product category `document.modelContext` tool.
- `getCartToolEnabled`: enables the cart read `document.modelContext` tool.
- `addToCartToolEnabled`: enables the cart mutation `document.modelContext` tool.
- `updateLineItemToolEnabled`: enables the cart line item update `document.modelContext` tool.
- `removeFromCartToolEnabled`: enables the cart removal `document.modelContext` tool.

`staticElementsJson` accepts either an array of element objects or an object
with an `elements` array. Each element must include `selector`, `role`, and
`name`. Optional `action` values are validated before being emitted.

Example:

```json
{
  "elements": [
    {
      "selector": ".footer-newsletter input[type=\"email\"]",
      "role": "input.email",
      "name": "NEWSLETTER_EMAIL",
      "description": "Newsletter email address"
    },
    {
      "selector": ".footer-newsletter button[type=\"submit\"]",
      "role": "button.submit",
      "name": "SUBMIT_NEWSLETTER",
      "action": {
        "kind": "POST",
        "endpoint": "/newsletter/subscribe",
        "params": {
          "email": "$NEWSLETTER_EMAIL"
        }
      }
    }
  ]
}
```

Supported action methods are `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`.
Action endpoints may be absolute URLs, same-origin paths beginning with `/`, or
symbolic endpoints such as `@ADD_TO_CART`.

## Extend

To add or change browser tools, keep the public fallback runtime and storefront
plugin import in sync. Changes to
`src/Resources/public/webmcp-model-context.js` affect both the direct public
fallback script and the Shopware storefront plugin import.

Use the existing vanilla JavaScript module style in
`src/Resources/public/webmcp-model-context`. Keep tool inputs and outputs
stable, especially `structuredContent`, unless the change intentionally updates
the WebMCP contract.

When extending configuration, update the Shopware Admin configuration,
service wiring, routes, Twig data attributes, storefront runtime behavior, and
this README together.

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
- If cart mutation tools update the session but the header cart does not refresh, the active theme may not register Shopware's `CartWidget` plugin. The runtime requests a best-effort cart widget refresh after successful mutations.
- Browser-side native tool registration depends on Chrome's WebMCP testing support; `document.modelContext` remains available for manual console testing.

## Local QA & Contributions

The local workflow does not require host PHP or Composer:

    docker compose run --rm qa

If host PHP and Composer are available, this also runs the PHP lint pass:

    composer qa

Build an installable zip:

    docker compose run --rm qa bin/build-zip.sh

Contribution notes:

- Keep the package structure conventional for a Shopware platform plugin.
- Preserve the public endpoints unless a task explicitly changes them.
- Keep browser globals and `shopware_webmcp_*` tool names stable.
- Prefer small, cohesive changes over new infrastructure or dependencies.
- Validate runtime input from plugin config, routes, Store API payloads, and browser tool arguments.

## License

See [LICENSE](LICENSE).
