import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage for the full WebMCP tool surface, driven exactly the way an
 * AI agent would drive it: through `document.modelContext.callTool(...)` on a real
 * Shopware storefront with the plugin active and demo data present.
 *
 * These are the regression net for refactoring the storefront runtime — if a tool
 * stops registering, changes its input contract, or breaks its structured output,
 * one of these fails.
 */

const TOOL = {
    searchProducts: 'shopware_webmcp_search_products',
    getProduct: 'shopware_webmcp_get_product',
    getProductCategories: 'shopware_webmcp_get_product_categories',
    getCart: 'shopware_webmcp_get_cart',
    addToCart: 'shopware_webmcp_add_to_cart',
    updateLineItem: 'shopware_webmcp_update_line_item',
    removeFromCart: 'shopware_webmcp_remove_from_cart',
} as const;

type ToolResult = {
    content: Array<{ type: string; text: string }>;
    structuredContent: Record<string, any>;
};

/** Load the storefront and wait until the WebMCP runtime has registered its tools. */
async function openStorefront(page: Page): Promise<void> {
    await page.goto('/');
    await page.waitForFunction(
        (searchToolName) => {
            const mc = (document as any).modelContext;
            return (
                !!mc &&
                typeof mc.getTools === 'function' &&
                mc.getTools().some((tool: any) => tool && tool.name === searchToolName)
            );
        },
        TOOL.searchProducts,
        { timeout: 30_000 },
    );
}

/** Call a tool the way an agent does and return its raw result. */
async function callTool(page: Page, name: string, input: Record<string, unknown> = {}): Promise<ToolResult> {
    return page.evaluate(
        async ([toolName, toolInput]) => {
            const mc = (document as any).modelContext;
            return (await mc.callTool(toolName, toolInput)) as ToolResult;
        },
        [name, input] as const,
    );
}

function expectValidToolResult(result: ToolResult): void {
    expect(result).toBeTruthy();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect(typeof result.content[0]?.text).toBe('string');
    expect(result.structuredContent).toBeTruthy();
}

test.beforeEach(async ({ page }) => {
    await openStorefront(page);
});

test('registers the full WebMCP tool surface', async ({ page }) => {
    const registered = await page.evaluate(() =>
        ((document as any).modelContext.getTools() as Array<{ name: string }>).map((tool) => tool.name),
    );

    for (const name of Object.values(TOOL)) {
        expect(registered, `tool ${name} should be registered`).toContain(name);
    }
});

test('search_products lists products from the real catalog', async ({ page }) => {
    const result = await callTool(page, TOOL.searchProducts, { limit: 5 });

    expectValidToolResult(result);
    const { products, count, total } = result.structuredContent;
    expect(Array.isArray(products)).toBe(true);
    expect(count).toBeGreaterThan(0);
    expect(count).toBe(products.length);
    expect(total).toBeGreaterThanOrEqual(count);
    expect(typeof products[0].name).toBe('string');
});

test('search_products honors a query term', async ({ page }) => {
    const result = await callTool(page, TOOL.searchProducts, { query: 'a', limit: 3 });

    expectValidToolResult(result);
    expect(result.structuredContent.query).toBe('a');
    expect(result.structuredContent.products.length).toBeLessThanOrEqual(3);
});

test('get_product returns details for a product found via search', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 1 });
    const first = search.structuredContent.products[0];
    expect(first?.id, 'search result should carry a product id').toBeTruthy();

    const result = await callTool(page, TOOL.getProduct, { id: first.id });

    expectValidToolResult(result);
    expect(result.structuredContent.lookup).toMatchObject({ id: first.id });
    expect(typeof result.structuredContent.product.name).toBe('string');
    expect(result.structuredContent.product.id).toBe(first.id);
});

test('get_product_categories returns a category structure', async ({ page }) => {
    // NOTE: this tool infers the tree from storefront DOM/breadcrumbs (see ADR 0001
    // §6 / roadmap B1). Assertions stay structural rather than value-exact so a
    // theme tweak does not make the test flaky.
    const result = await callTool(page, TOOL.getProductCategories, { scope: 'tree' });

    expectValidToolResult(result);
    expect(result.structuredContent.scope).toBe('tree');
    expect(Array.isArray(result.structuredContent.categories)).toBe(true);
});

test('get_cart returns a cart structure on a fresh session', async ({ page }) => {
    const result = await callTool(page, TOOL.getCart);

    expectValidToolResult(result);
    expect(result.structuredContent.cart).toBeTruthy();
    expect(Array.isArray(result.structuredContent.cart.lineItems)).toBe(true);
});

test('cart lifecycle: add → read → update → remove', async ({ page }) => {
    // One test = one browser context = one shared shopper session, so the cart
    // persists across the steps below.
    const search = await callTool(page, TOOL.searchProducts, { limit: 1 });
    const product = search.structuredContent.products[0];
    expect(product?.id, 'need a product to put in the cart').toBeTruthy();

    // add
    const added = await callTool(page, TOOL.addToCart, { id: product.id, quantity: 1 });
    expectValidToolResult(added);
    expect(added.structuredContent.added).toMatchObject({ id: product.id, quantity: 1 });
    expect(added.structuredContent.cart.itemCount).toBeGreaterThanOrEqual(1);

    // read back + locate the created line item
    const afterAdd = await callTool(page, TOOL.getCart);
    const lineItems: Array<Record<string, any>> = afterAdd.structuredContent.cart.lineItems;
    expect(lineItems.length).toBeGreaterThanOrEqual(1);
    const lineItemId: string | undefined = lineItems[0]?.id;
    expect(lineItemId, 'cart line item should expose an id').toBeTruthy();

    // update quantity to 2
    const updated = await callTool(page, TOOL.updateLineItem, { lineItemId, quantity: 2 });
    expectValidToolResult(updated);
    expect(updated.structuredContent.skipped).toBeFalsy();
    expect(updated.structuredContent.updated).toMatchObject({ lineItemId, quantity: 2 });

    const afterUpdate = await callTool(page, TOOL.getCart);
    const updatedLine = (afterUpdate.structuredContent.cart.lineItems as Array<Record<string, any>>).find(
        (item) => item.id === lineItemId,
    );
    expect(updatedLine?.quantity).toBe(2);

    // remove
    const removed = await callTool(page, TOOL.removeFromCart, { lineItemId, quantity: 2 });
    expectValidToolResult(removed);
    expect(removed.structuredContent.removed).toMatchObject({ lineItemId });

    const afterRemove = await callTool(page, TOOL.getCart);
    const stillPresent = (afterRemove.structuredContent.cart.lineItems as Array<Record<string, any>>).some(
        (item) => item.id === lineItemId,
    );
    expect(stillPresent, 'line item should be gone after removal').toBe(false);
});

test('update_line_item reports skipped for a line item that is not in the cart', async ({ page }) => {
    const result = await callTool(page, TOOL.updateLineItem, {
        lineItemId: 'this-line-item-does-not-exist',
        quantity: 1,
    });

    expectValidToolResult(result);
    expect(result.structuredContent.skipped).toBe(true);
    expect(result.structuredContent.reason).toBe('not_in_cart');
});
