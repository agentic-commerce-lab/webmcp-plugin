# Shopware WebMCP

This repository contains a Shopware 6 plugin that publishes a WebMCP side-car
document for a storefront and registers browser-side `document.modelContext`
tools for product discovery, category discovery, and cart operations.

The plugin uses a conventional root-level Shopware package structure:

- `composer.json` declares the Shopware plugin package and autoloading.
- `src/SwagWebMcp.php` is the plugin class.
- `src/Resources/config` contains Shopware service, route, and plugin configuration.
- `src/WebMcp` contains the document controller, config reader, and cart payload builder.
- `src/Resources/views` injects the storefront WebMCP configuration and fallback runtime.
- `src/Resources/app/storefront/src` contains the Shopware storefront JavaScript plugin.
- `src/Resources/public` contains the browser runtime used by both the storefront plugin and fallback script.

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

After installation, enable or configure the plugin in Shopware Admin under the plugin configuration screen.

## Endpoints

When enabled, the storefront exposes:

- `GET /webmcp.wmcp`: returns the WebMCP side-car document as `application/webmcp+json`.
- `GET /webmcp/cart`: returns the current shopper cart as JSON for the browser-side `get_cart` tool.

Endpoint behavior:

- `/webmcp.wmcp` returns `404` when the plugin is disabled.
- `/webmcp.wmcp` sends `Cache-Control: public, max-age=300`.
- `/webmcp/cart` returns `404` when the plugin or `get_cart` tool is disabled.
- `/webmcp/cart` returns `400` when Shopware cannot provide a sales channel context.
- `/webmcp/cart` sends `Cache-Control: private, no-store`.
- Cart data is session-bound through the current storefront shopper context.

## Configuration

Shopware renders these settings in the plugin configuration screen in the Admin panel.

The plugin configuration currently supports:

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

`staticElementsJson` accepts either an array of element objects or an object with an
`elements` array. Each element must include `selector`, `role`, and `name`.
Optional `action` values are validated before being emitted.

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

## Storefront Runtime

The plugin uses Shopware's storefront JavaScript entrypoint at
`src/Resources/app/storefront/src/main.js`. It registers
`SwagWebMcpModelContext` through `window.PluginManager`, and Twig passes
Shopware Admin settings through Shopware data-options on the bound config element.

Twig also passes the current sales channel's Store API access key so product
lookup tools can call Shopware's Store API. Cart mutations use same-origin
storefront cart endpoints with the shopper's session cookies so storefront UI
refreshes see the same cart. Twig also loads the same browser runtime from
`src/Resources/public/webmcp-model-context.js` so WebMCP tools still initialize
if the active storefront bundle has not included the plugin entrypoint.

When the storefront runtime initializes, it builds a browser-side WebMCP document
at `document.webMcp`, creates `document.modelContext` if needed, and registers
the enabled tools.

## Model Context Tools

All tools return WebMCP-style results with `content` text and `structuredContent`
data. Product lookup tools use the Shopware Store API with customer context.
Cart mutation tools use the storefront cart routes and publish a cart update
event after successful mutations.

| Tool | Input | Structured output |
| --- | --- | --- |
| `shopware.webmcp.search_products` | Optional `query`; optional `limit` from `1` to `20`, default `5`. | `query`, `count`, `total`, `products`. |
| `shopware.webmcp.get_product` | Exactly one of `id`, `sku`, or same-origin product `url`. | `lookup`, `product`. |
| `shopware.webmcp.get_product_categories` | Optional `scope`: `tree` or `product`; optional `sku` or same-origin `url`. `sku` implies `product` scope. | `lookup`, `scope`, `source`, `sourceUrl`, `count`, `activeCategoryIds`, `categories`, `tree`. |
| `shopware.webmcp.get_cart` | No input properties. | `cart`. |
| `shopware.webmcp.add_to_cart` | Exactly one of `id`, `sku`, or same-origin product `url`; optional `quantity` from `1` to `100`, default `1`. | `added`, `cart`. |
| `shopware.webmcp.update_line_item` | Exactly one of `lineItemId`, `id`, `sku`, or same-origin product `url`; required `quantity` from `0` to `100`. Quantity `0` removes the line item. | `updated`, `cart`, or `skipped` with `reason`. |
| `shopware.webmcp.remove_from_cart` | Exactly one of `lineItemId`, `id`, `sku`, or same-origin product `url`; optional `quantity` from `1` to `100`, default `1`. | `removed`, `cart`. |

Product URLs must be same-origin storefront URLs or paths. `/detail/{id}` URLs
can be resolved directly; SKU lookups resolve through Store API product search.

## Browser Events

The runtime dispatches these document events:

- `webmcp:document-ready`: fired when the WebMCP document is available.
- `webmcp:model-context-ready`: fired when a tool is registered or removed.
- `webmcp:cart-updated`: fired after a successful cart mutation.

The runtime also listens for these document events and attempts to bootstrap
again when they are dispatched:

- `webmcp:document-request`
- `webmcp:model-context-request`

Bootstrap is idempotent; repeated calls update existing WebMCP tools rather than
adding duplicate entries.

## Manual Testing

Open a storefront page and run these examples in the browser console:

```js
document.webMcp.getDocument()
document.modelContext.getTools()

await document.modelContext.callTool('shopware.webmcp.search_products', {})
const searchResult = await document.modelContext.callTool(
    'shopware.webmcp.search_products',
    { query: 'shirt', limit: 3 },
)

await document.modelContext.callTool('shopware.webmcp.get_product', { sku: 'SWDEMO10006' })
await document.modelContext.callTool('shopware.webmcp.get_product', {
    id: searchResult.structuredContent.products[0].id,
})

await document.modelContext.callTool('shopware.webmcp.get_product_categories', {})
await document.modelContext.callTool('shopware.webmcp.get_product_categories', {
    sku: 'SWDEMO10006',
})

await document.modelContext.callTool('shopware.webmcp.get_cart', {})
await document.modelContext.callTool('shopware.webmcp.add_to_cart', {
    sku: 'SWDEMO10006',
    quantity: 1,
})

const cartResult = await document.modelContext.callTool('shopware.webmcp.get_cart', {})
await document.modelContext.callTool('shopware.webmcp.update_line_item', {
    lineItemId: cartResult.structuredContent.cart.lineItems[0].id,
    quantity: 2,
})
await document.modelContext.callTool('shopware.webmcp.update_line_item', {
    sku: 'SWDEMO10006',
    quantity: 0,
})
await document.modelContext.callTool('shopware.webmcp.remove_from_cart', {
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

## Troubleshooting

If `window.SwagWebMcp` is undefined, check the page source for
`data-swag-web-mcp-model-context` and `webmcp-model-context.js`. If either is
missing, rerun:

    bin/console assets:install
    bin/console theme:compile
    bin/console cache:clear

If product tools fail with `401` or `403`, confirm the storefront page includes
a valid sales channel Store API access key and that the current sales channel
allows Store API product access.

If `get_cart` returns `404`, confirm the plugin is enabled and
`getCartToolEnabled` is enabled in Shopware Admin.

If `/webmcp/cart` returns `400`, the request did not receive a Shopware sales
channel context. Test from a storefront route rather than an admin or CLI
context.

If cart mutation tools update the session but the header cart does not refresh,
check whether the active theme still registers Shopware's `CartWidget` plugin.
The WebMCP runtime requests a best-effort cart widget refresh after successful
mutations.

## Security Notes

- Do not expose private backend credentials in storefront code or plugin config.
- The Store API access key is a storefront value used by Shopware browser clients.
- Cart read and mutation requests use same-origin storefront session cookies.
- CSRF tokens are read from the storefront when available and sent with cart
  mutation requests.
- Tool inputs are validated and normalized before Store API or storefront cart
  requests are made.

## Local QA

The local workflow does not require host PHP or Composer:

    docker compose run --rm qa

If host PHP and Composer are available, this also runs the PHP lint pass:

    composer qa

Build an installable zip:

    docker compose run --rm qa bin/build-zip.sh
