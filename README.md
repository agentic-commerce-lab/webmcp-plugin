# Shopware WebMCP

This repository contains a Shopware 6 plugin that publishes a WebMCP side-car document for a storefront.

The plugin uses a conventional root-level Shopware package structure:

- `composer.json` declares the Shopware plugin package and autoloading.
- `src/SwagWebMcp.php` is the plugin class.
- `src/Resources/config` contains Shopware service, route, and plugin configuration.
- `src/WebMcp` contains the document controller, config reader, document builder, and element providers.

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

The plugin configuration currently supports:

- `enabled`: enables the public WebMCP document endpoint.
- `context`: human-readable context for the WebMCP document.
- `staticElementsJson`: optional JSON for additional WebMCP element definitions.

`staticElementsJson` accepts either an array of element objects or an object with an `elements` array. Each element must include `selector`, `role`, and `name`; optional `action` values are validated before being emitted.

## Storefront Script

The plugin injects `src/Resources/public/webmcp-hello-world.global.js` through a Twig script tag.

When the script loads, it creates `document.modelContext` if needed and registers a test tool immediately:

- `shopware.webmcp.hello_world`

For manual testing in the browser console:

    window.SwagWebMcp.registerHelloWorldTool()
    document.modelContext.getTools()
    await document.modelContext.callTool('shopware.webmcp.hello_world', { subject: 'tester' })

If `window.SwagWebMcp` is undefined, check the page source for `webmcp-hello-world.global.js`. If it is missing, rerun `bin/console assets:install`, `bin/console theme:compile`, and `bin/console cache:clear`.

## Local QA

The local workflow does not require host PHP or Composer:

    docker compose run --rm qa

Build an installable zip:

    docker compose run --rm qa bin/build-zip.sh
