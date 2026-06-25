# Shopware WebMCP

This repository contains a Shopware 6 plugin that publishes a WebMCP side-car document for a storefront.

The plugin uses a conventional root-level Shopware package structure:

- `composer.json` declares the Shopware plugin package and autoloading.
- `src/SwagWebMcp.php` is the plugin class.
- `src/Resources/config` contains Shopware service, route, and plugin configuration.
- `src/WebMcp` contains the document controller and Shopware config reader.
- `src/Resources/app/storefront/src` contains the storefront JavaScript plugin.

## Installation

Install this repository as a Shopware platform plugin:

    mkdir -p custom/plugins
    cp -R <repository-path> custom/plugins/SwagWebMcp
    bin/console plugin:refresh
    bin/console plugin:install --activate SwagWebMcp
    bin/console assets:install
    bin/console theme:compile
    bin/console cache:clear

## Endpoints

When enabled, the storefront exposes a WebMCP side-car document:

- `GET /webmcp.wmcp`

The response is served as `application/webmcp+json` and returns `404` when the plugin is disabled in Shopware Admin.

## Configuration

Shopware renders these settings in the plugin configuration screen in the Admin panel.

The plugin configuration currently supports:

- `enabled`: enables the public WebMCP document endpoint.
- `context`: human-readable context for the WebMCP document.
- `staticElementsJson`: optional JSON for additional WebMCP element definitions.
- `searchProductsToolEnabled`: enables the product search `document.modelContext` tool.
- `getProductToolEnabled`: enables the product detail `document.modelContext` tool.

`staticElementsJson` accepts either an array of element objects or an object with an `elements` array. Each element must include `selector`, `role`, and `name`; optional `action` values are validated before being emitted.

## Storefront Script

The plugin uses Shopware's storefront JavaScript entrypoint at `src/Resources/app/storefront/src/main.js`.
It registers `SwagWebMcpModelContext` through `window.PluginManager`, and Twig passes Shopware Admin settings through Shopware data-options on the bound config element.
Twig also loads the same browser runtime from `src/Resources/public/webmcp-model-context.js` so WebMCP tools still initialize if the active storefront bundle has not included the plugin entrypoint.

When the storefront JavaScript plugin initializes, it builds a browser-side WebMCP document at `document.webMcp`, creates `document.modelContext` if needed, and registers enabled tools:

- `shopware.webmcp.search_products`
- `shopware.webmcp.get_product`

For manual testing in the browser console:

    window.SwagWebMcp.registerSearchProductsTool()
    window.SwagWebMcp.registerGetProductTool()
    document.webMcp.getDocument()
    document.modelContext.getTools()
    const searchResult = await document.modelContext.callTool('shopware.webmcp.search_products', { query: 'shirt', limit: 3 })
    await document.modelContext.callTool('shopware.webmcp.get_product', { sku: 'SWDEMO10006' })
    await document.modelContext.callTool('shopware.webmcp.get_product', { url: searchResult.structuredContent.products[0].url })

If `window.SwagWebMcp` is undefined, check the page source for `data-swag-web-mcp-model-context` and `webmcp-model-context.js`. If either is missing, rerun `bin/console assets:install`, `bin/console theme:compile`, and `bin/console cache:clear`.

## Local QA

The local workflow does not require host PHP or Composer:

    docker compose run --rm qa

Build an installable zip:

    docker compose run --rm qa bin/build-zip.sh
