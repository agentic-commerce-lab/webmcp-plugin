/**
 * The six benchmark tasks with scripted success checks.
 *
 * A checker receives { page, context, ctx, config } and returns true/false.
 * `ctx.toolOutputs` contains every tool/snapshot payload the agent received
 * (so WebMCP agents that never navigate can still pass checks based on the
 * data they saw); `ctx.visited` contains all navigated URLs.
 */

function norm(url) {
    return String(url)
        .replace(/[?#].*$/, '')
        .replace(/\/$/, '')
        .toLowerCase();
}

function saw(ctx, needle) {
    const haystack = [...ctx.visited, ...ctx.toolOutputs].join('\n').toLowerCase();
    return haystack.includes(String(needle).toLowerCase());
}

function visited(ctx, urlPath) {
    return [...ctx.visited].some((url) => norm(url).endsWith(norm(urlPath)));
}

async function cartContains(context, productId, quantity) {
    const response = await context.request.get('/webmcp/cart');
    if (!response.ok()) return false;
    const cart = await response.json();
    const items = cart?.lineItems ?? cart?.items ?? [];
    return items.some((item) => {
        const id = item.productId ?? item.referencedId ?? item.id;
        return id === productId && (item.quantity ?? 1) >= quantity;
    });
}

export function buildTasks(config) {
    return [
        {
            id: 'open-category',
            prompt: `Open the category "${config.categoryName}" in this shop.`,
            check: async ({ page, ctx }) => {
                return norm(page.url()).endsWith(norm(config.categoryUrl)) || visited(ctx, config.categoryUrl);
            },
        },
        {
            id: 'open-two-products',
            prompt: `From the category "${config.categoryName}", open these two products: "${config.productAName}" and "${config.productBName}".`,
            check: async ({ ctx }) => {
                const a = visited(ctx, config.productAUrl) || saw(ctx, config.productAName);
                const b = visited(ctx, config.productBUrl) || saw(ctx, config.productBName);
                return a && b;
            },
        },
        {
            id: 'search-product',
            prompt: `Search the shop for "${config.searchTerm}" and find the product "${config.searchResultName}".`,
            check: async ({ page, ctx }) => {
                const onResults =
                    /search/i.test(page.url()) &&
                    (await page.content()).toLowerCase().includes(config.searchResultName.toLowerCase());
                return onResults || saw(ctx, config.searchResultName);
            },
        },
        {
            id: 'filter-products',
            prompt: `In the category "${config.categoryName}", filter the product listing to show ${config.filterDescription}.`,
            check: async ({ ctx }) => saw(ctx, config.filterExpect),
        },
        {
            id: 'open-pdp',
            prompt: `Open the product detail page of "${config.pdpProductName}".`,
            check: async ({ ctx }) => {
                return visited(ctx, config.pdpProductUrl) || saw(ctx, config.pdpProductName);
            },
        },
        {
            id: 'add-variant-to-cart',
            prompt: `Add the product "${config.variantProductName}" in the variant "${config.variantDescription}" to the cart, quantity ${config.variantQuantity}.`,
            check: async ({ context }) => cartContains(context, config.variantProductId, config.variantQuantity),
        },
    ];
}
