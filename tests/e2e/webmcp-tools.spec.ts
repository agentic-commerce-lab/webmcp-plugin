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
    getListingFilters: 'shopware_webmcp_get_listing_filters',
    filterProducts: 'shopware_webmcp_filter_products',
    getCart: 'shopware_webmcp_get_cart',
    addToCart: 'shopware_webmcp_add_to_cart',
    updateLineItem: 'shopware_webmcp_update_line_item',
    clearCart: 'shopware_webmcp_clear_cart',
    getSalesChannelContext: 'shopware_webmcp_get_sales_channel_context',
    navigate: 'shopware_webmcp_navigate',
} as const;

// Registered only on a product detail page (page-scoped), so it is not part of the global surface.
const SELECT_VARIANT_TOOL = 'shopware_webmcp_select_variant';

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

// Shopware demo customer shipped with the Dockware dev shop.
const DEMO_CUSTOMER = { email: 'test@example.com', password: 'shopware' } as const;

/** The product-id-keyed line items currently in the cart, read via the agent's get_cart tool. */
async function cartLineItemIds(page: Page): Promise<string[]> {
    // Data probe — suppress the cart overlay so it does not pop during verification reads.
    const result = await callTool(page, TOOL.getCart, { showCartOverlay: false });
    const lineItems = (result.structuredContent.cart?.lineItems ?? []) as Array<Record<string, any>>;
    return lineItems.map((item) => String(item.id));
}

/** Log in through the real storefront login form (a full navigation → token rotation + cart merge). */
async function loginViaStorefront(page: Page, email: string, password: string): Promise<void> {
    await page.goto('/account/login');
    const form = page.locator('form:has(#loginMail)');
    await form.locator('#loginMail').fill(email);
    await form.locator('input[name="password"]').fill(password);
    await form.locator('button[type="submit"]').click();
    // A successful login redirects away from /account/login to the account overview.
    await page.waitForURL((url) => !url.pathname.includes('/account/login'), { timeout: 15_000 });
}

/** Add a product to the cart the way a shopper does: the storefront detail page buy button. */
async function addToCartViaStorefront(page: Page, productUrl: string): Promise<void> {
    await page.goto(productUrl);
    await page.locator('.btn-buy').first().click();
    // The off-canvas cart confirms the storefront-side add landed.
    await expect(page.locator('.cart-offcanvas, .offcanvas').first()).toBeVisible({ timeout: 15_000 });
    await page.goto('/');
}

/** Remove products from the cart so a persisted customer cart does not leak across runs. */
async function removeFromCart(page: Page, productIds: string[]): Promise<void> {
    for (const id of productIds) {
        await callTool(page, TOOL.updateLineItem, { id, quantity: 0, showCartOverlay: false });
    }
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
    const result = await callTool(page, TOOL.searchProducts, { limit: 5, showResults: false });

    expectValidToolResult(result);
    const { products, count, total } = result.structuredContent;
    expect(Array.isArray(products)).toBe(true);
    expect(count).toBeGreaterThan(0);
    expect(count).toBe(products.length);
    expect(total).toBeGreaterThanOrEqual(count);
    expect(typeof products[0].name).toBe('string');
});

test('search_products honors a query term (data only)', async ({ page }) => {
    // showResults:false = data probe, the page must not move.
    const result = await callTool(page, TOOL.searchProducts, { query: 'a', limit: 3, showResults: false });

    expectValidToolResult(result);
    expect(result.structuredContent.query).toBe('a');
    expect(result.structuredContent.products.length).toBeLessThanOrEqual(3);
    expect(result.structuredContent.shownInBrowser).toBe(false);
});

test('search_products with a query navigates the shopper to the search results page', async ({ page }) => {
    // The browse default: "search for variant" should show the shopper the storefront search page.
    const result = await callTool(page, TOOL.searchProducts, { query: 'variant' });

    expectValidToolResult(result);
    expect(result.structuredContent.shownInBrowser).toBe(true);
    expect(String(result.structuredContent.listingUrl)).toContain('search=variant');
    await page.waitForURL(/[?&]search=variant/, { timeout: 15_000 });
});

test('search_products without a query shows all products on the search page', async ({ page }) => {
    // "show me all products" — no query — still lands the shopper on a real listing page.
    const result = await callTool(page, TOOL.searchProducts, {});

    expectValidToolResult(result);
    expect(result.structuredContent.shownInBrowser).toBe(true);
    expect(String(result.structuredContent.listingUrl)).toContain('/search');
    await page.waitForURL(/\/search(\?|$)/, { timeout: 15_000 });
});

test('get_product returns details for a product found via search', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 1, showResults: false });
    const first = search.structuredContent.products[0];
    expect(first?.id, 'search result should carry a product id').toBeTruthy();

    const result = await callTool(page, TOOL.getProduct, { id: first.id, showResults: false });

    expectValidToolResult(result);
    expect(result.structuredContent.lookup).toMatchObject({ id: first.id });
    expect(result.structuredContent.shownInBrowser).toBe(false);
    expect(typeof result.structuredContent.product.name).toBe('string');
    expect(result.structuredContent.product.id).toBe(first.id);
});

test('get_product opens the product detail page for the shopper by default', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 1, showResults: false });
    const first = search.structuredContent.products[0];
    expect(first?.id, 'search result should carry a product id').toBeTruthy();

    const result = await callTool(page, TOOL.getProduct, { id: first.id });

    expectValidToolResult(result);
    expect(result.structuredContent.shownInBrowser).toBe(true);
    // The shopper is taken off the home page onto the product detail page.
    await page.waitForURL((url) => url.pathname.length > 1, { timeout: 15_000 });
});

test('get_product_categories returns a category structure', async ({ page }) => {
    // NOTE: this tool reads the navigation tree from the Shopware Store API (see
    // ADR 0001), marking the active trail from the current page. Assertions stay
    // structural rather than value-exact so demo-data changes do not make it flaky.
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
    // persists across the steps below. Cart writes are product-keyed (id/sku/url):
    // a product line item's id equals the product id, so we key everything on it.
    const search = await callTool(page, TOOL.searchProducts, { limit: 1, showResults: false });
    const product = search.structuredContent.products[0];
    expect(product?.id, 'need a product to put in the cart').toBeTruthy();

    // add
    const added = await callTool(page, TOOL.addToCart, { id: product.id, quantity: 1 });
    expectValidToolResult(added);
    expect(added.structuredContent.added).toMatchObject({ id: product.id, quantity: 1 });
    expect(added.structuredContent.cart.itemCount).toBeGreaterThanOrEqual(1);

    // read back + confirm the line item is addressable by the product id
    const afterAdd = await callTool(page, TOOL.getCart);
    const lineItems: Array<Record<string, any>> = afterAdd.structuredContent.cart.lineItems;
    expect(lineItems.some((item) => item.id === product.id)).toBe(true);

    // set target quantity to 2 (declarative)
    const updated = await callTool(page, TOOL.updateLineItem, { id: product.id, quantity: 2 });
    expectValidToolResult(updated);
    expect(updated.structuredContent.updated).toMatchObject({ id: product.id, quantity: 2 });

    const afterUpdate = await callTool(page, TOOL.getCart);
    const updatedLine = (afterUpdate.structuredContent.cart.lineItems as Array<Record<string, any>>).find(
        (item) => item.id === product.id,
    );
    expect(updatedLine?.quantity).toBe(2);

    // remove via target quantity 0
    const removed = await callTool(page, TOOL.updateLineItem, { id: product.id, quantity: 0 });
    expectValidToolResult(removed);
    expect(removed.structuredContent.updated).toMatchObject({ id: product.id, quantity: 0 });

    const afterRemove = await callTool(page, TOOL.getCart);
    const stillPresent = (afterRemove.structuredContent.cart.lineItems as Array<Record<string, any>>).some(
        (item) => item.id === product.id,
    );
    expect(stillPresent, 'line item should be gone after removal').toBe(false);
});

test('add_to_cart is additive: adding the same product twice sums the quantity', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 1, showResults: false });
    const product = search.structuredContent.products[0];
    expect(product?.id, 'need a product to add').toBeTruthy();

    await callTool(page, TOOL.addToCart, { id: product.id, quantity: 1 });
    await callTool(page, TOOL.addToCart, { id: product.id, quantity: 1 });

    const cart = await callTool(page, TOOL.getCart);
    const line = (cart.structuredContent.cart.lineItems as Array<Record<string, any>>).find(
        (item) => item.id === product.id,
    );
    expect(line?.quantity, 'two relative adds of qty 1 sum to 2').toBe(2);

    await removeFromCart(page, [product.id]);
});

test('cart projection: a multi-line cart carries the compact CartSummary fields', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 2, showResults: false });
    const [a, b] = search.structuredContent.products as Array<Record<string, any>>;
    expect(a?.id && b?.id, 'need two distinct products').toBeTruthy();

    await callTool(page, TOOL.addToCart, { id: a.id, quantity: 2 });
    await callTool(page, TOOL.addToCart, { id: b.id, quantity: 1 });

    const result = await callTool(page, TOOL.getCart);
    const cart = result.structuredContent.cart;

    // Cart-level projection. itemCount sums product quantities (2 + 1); it ignores any
    // rule-inserted non-product line, so it stays exact. lineItemCount / lineItems may
    // carry an extra promotion line on some demo data, hence the >= assertions.
    expect(Array.isArray(cart.lineItems)).toBe(true);
    expect(cart.lineItems.length).toBeGreaterThanOrEqual(2);
    expect(cart.lineItemCount).toBeGreaterThanOrEqual(2);
    expect(cart.itemCount).toBe(3);
    expect(cart.totals?.total?.value).toBeGreaterThan(0);
    expect(cart.checkoutUrl).toContain('/checkout');

    // Per-line projection for product A.
    const lineA = (cart.lineItems as Array<Record<string, any>>).find((i) => i.id === a.id);
    expect(lineA, 'product A line present').toBeTruthy();
    expect(lineA?.type).toBe('product');
    expect(lineA?.quantity).toBe(2);
    expect(typeof lineA?.label).toBe('string');
    expect(lineA?.referencedId).toBe(a.id);
    expect(lineA?.url).toContain(`/detail/${a.id}`);
    expect(lineA?.unitPrice?.value).toBeGreaterThan(0);
    expect(lineA?.totalPrice?.value).toBeGreaterThan(0);

    await removeFromCart(page, [a.id, b.id]);
});

test('update_line_item to quantity 0 is an idempotent no-op for a product not in the cart', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 1, showResults: false });
    const product = search.structuredContent.products[0];
    expect(product?.id, 'need a product id to target').toBeTruthy();

    const result = await callTool(page, TOOL.updateLineItem, { id: product.id, quantity: 0 });

    expectValidToolResult(result);
    const present = (result.structuredContent.cart?.lineItems as Array<Record<string, any>> | undefined)?.some(
        (item) => item.id === product.id,
    );
    expect(present ?? false).toBe(false);
});

// --- WebMCP cart tools operate the storefront session cart (ADR 0004) ----------
// The cart tools write through Shopware's stock storefront routes (session cookie), so a
// tool-driven change lands in the shopper's own session cart. We prove it by reading the
// cart straight from Shopware's own `/checkout/cart.json` — bypassing our tools entirely —
// and confirming the tool's change is there. This also implicitly confirms no token is
// needed: the fetch below sends only the session cookie.

test('cart tools write to the shopper session cart, visible via Shopware /checkout/cart.json', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 1, showResults: false });
    const product = search.structuredContent.products[0];
    expect(product?.id, 'need a product to add').toBeTruthy();

    // Agent adds via the WebMCP tool (which writes through the storefront cart routes).
    await callTool(page, TOOL.addToCart, { id: product.id, quantity: 2 });

    // Read the cart straight from Shopware's own session endpoint, not via our tools.
    const storefrontCart = await page.evaluate(async () => {
        const res = await fetch('/checkout/cart.json', {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
        });
        return (await res.json()) as { lineItems?: Array<Record<string, any>> };
    });
    const line = (storefrontCart.lineItems ?? []).find((item) => item.id === product.id);
    expect(line, 'the tool add is visible in the shopper session cart (cart.json)').toBeTruthy();
    expect(line?.quantity, 'quantity matches the tool call').toBe(2);

    // And a target update / remove through the tool is reflected there too.
    await callTool(page, TOOL.updateLineItem, { id: product.id, quantity: 0 });
    const afterRemove = await page.evaluate(async () => {
        const res = await fetch('/checkout/cart.json', {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
        });
        return (await res.json()) as { lineItems?: Array<Record<string, any>> };
    });
    expect(
        (afterRemove.lineItems ?? []).some((item) => item.id === product.id),
        'the tool removal is reflected in cart.json',
    ).toBe(false);
});

test('clear_cart empties a filled cart', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 2, showResults: false });
    const [a, b] = search.structuredContent.products as Array<Record<string, any>>;
    expect(a?.id && b?.id, 'need two products').toBeTruthy();

    await callTool(page, TOOL.addToCart, { id: a.id, quantity: 1 });
    await callTool(page, TOOL.addToCart, { id: b.id, quantity: 2 });
    expect((await cartLineItemIds(page)).length, 'cart is filled before clear').toBeGreaterThanOrEqual(2);

    const result = await callTool(page, TOOL.clearCart);
    expectValidToolResult(result);
    expect(Array.isArray(result.structuredContent.cart?.lineItems)).toBe(true);
    expect(result.structuredContent.cart.lineItems.length, 'clear_cart returns an empty cart').toBe(0);

    // Shopware's own session cart is empty too.
    const storefrontLineItems = await page.evaluate(async () => {
        const res = await fetch('/checkout/cart.json', {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
        });
        const cart = (await res.json()) as { lineItems?: unknown[] };
        return (cart.lineItems ?? []).length;
    });
    expect(storefrontLineItems, 'session cart is empty via cart.json').toBe(0);
});

// --- Cross-login cart coherence (ADR 0004) -------------------------------------
// The cart runs on the storefront session (session cookie). On login Shopware rotates the
// context token and merges the guest cart into the customer cart. These tests pin that the
// agent (session-based cart tools) and the shopper (storefront) stay on one cart across it.

test('cart survives login: agent fills the cart as a guest, then the shopper logs in', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 1, showResults: false });
    const product = search.structuredContent.products[0];
    expect(product?.id, 'need a product to add').toBeTruthy();

    await callTool(page, TOOL.addToCart, { id: product.id, quantity: 1 });
    expect(await cartLineItemIds(page), 'guest cart holds the added product').toContain(product.id);

    await loginViaStorefront(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    // Re-open the storefront so the runtime re-bootstraps the now-rotated token.
    await openStorefront(page);

    expect(await cartLineItemIds(page), 'the guest cart merged into the customer cart on login').toContain(product.id);

    await removeFromCart(page, [product.id]);
});

test('shared cart before login: shopper adds via storefront, agent adds via tool, both survive login', async ({
    page,
}) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 2, showResults: false });
    const [shopperProduct, agentProduct] = search.structuredContent.products as Array<Record<string, any>>;
    expect(shopperProduct?.url, 'need a product detail url for the storefront add').toBeTruthy();
    expect(agentProduct?.id, 'need a second product for the agent add').toBeTruthy();

    // Shopper action (storefront session) and agent action (Store API token) as a guest.
    await addToCartViaStorefront(page, shopperProduct.url);
    await callTool(page, TOOL.addToCart, { id: agentProduct.id, quantity: 1 });

    // Pre-login: both land in ONE cart — proving the agent token == the shopper session.
    const beforeLogin = await cartLineItemIds(page);
    expect(beforeLogin, 'shopper item present pre-login').toContain(shopperProduct.id);
    expect(beforeLogin, 'agent item present pre-login').toContain(agentProduct.id);

    await loginViaStorefront(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    await openStorefront(page);

    const afterLogin = await cartLineItemIds(page);
    expect(afterLogin, 'shopper item survived login').toContain(shopperProduct.id);
    expect(afterLogin, 'agent item survived login').toContain(agentProduct.id);

    await removeFromCart(page, [shopperProduct.id, agentProduct.id]);
});

test('logged-in coherence: log in first, then agent and shopper add to the same cart', async ({ page }) => {
    await loginViaStorefront(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    await openStorefront(page);

    const search = await callTool(page, TOOL.searchProducts, { limit: 2, showResults: false });
    const [shopperProduct, agentProduct] = search.structuredContent.products as Array<Record<string, any>>;
    expect(shopperProduct?.url && agentProduct?.id, 'need two products').toBeTruthy();

    // Clean any residue from earlier runs so the assertions are about this run's adds.
    await removeFromCart(page, [shopperProduct.id, agentProduct.id]);

    await callTool(page, TOOL.addToCart, { id: agentProduct.id, quantity: 1 });
    await addToCartViaStorefront(page, shopperProduct.url);

    const cart = await cartLineItemIds(page);
    expect(cart, 'agent item present while logged in').toContain(agentProduct.id);
    expect(cart, 'shopper item present while logged in').toContain(shopperProduct.id);

    await removeFromCart(page, [shopperProduct.id, agentProduct.id]);
});

test('get_sales_channel_context returns the active sales channel context', async ({ page }) => {
    const result = await callTool(page, TOOL.getSalesChannelContext);

    expectValidToolResult(result);
    const context = result.structuredContent.salesChannelContext;
    expect(context).toBeTruthy();
    expect(context.currency?.isoCode, 'context should carry a currency iso code').toBeTruthy();
    expect(context.customer, 'context should report the customer login state').toBeTruthy();
});

test('navigate moves the storefront to a same-origin page (ACL-127)', async ({ page }) => {
    const result = await callTool(page, TOOL.navigate, { url: '/checkout/cart' });

    expectValidToolResult(result);
    expect(typeof result.structuredContent.navigatedTo).toBe('string');
    expect(result.structuredContent.navigatedTo).toContain('/checkout/cart');

    // The tool returns first, then assigns location; the browser follows.
    await page.waitForURL(/\/checkout\/cart/, { timeout: 15_000 });
});

test('add_to_cart with showCartOverlay opens the cart overlay (ACL-137)', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 1, showResults: false });
    const product = search.structuredContent.products[0];
    expect(product?.id, 'need a product to add').toBeTruthy();

    await callTool(page, TOOL.addToCart, { id: product.id, quantity: 1, showCartOverlay: true });

    // Shopware renders the off-canvas cart, giving the shopper direct feedback.
    await expect(page.locator('.cart-offcanvas').first()).toBeVisible({ timeout: 15_000 });
});

test('get_listing_filters returns the active category filter vocabulary (ACL-132)', async ({ page }) => {
    // No scope → the active category listing (the storefront home navigation category).
    const result = await callTool(page, TOOL.getListingFilters, {});

    expectValidToolResult(result);
    const filters = result.structuredContent.filters;
    expect(filters, 'a facet structure should be returned').toBeTruthy();
    expect(Array.isArray(filters.manufacturers)).toBe(true);
    expect(Array.isArray(filters.properties)).toBe(true);
    expect(Array.isArray(filters.sortings)).toBe(true);
    expect(typeof filters.total).toBe('number');
    expect(filters.sortings.length, 'a listing always advertises sort orders').toBeGreaterThan(0);
});

test('filter_products filters the active category and narrows by manufacturer (ACL-132)', async ({ page }) => {
    const unfiltered = await callTool(page, TOOL.filterProducts, { limit: 24, showResults: false });
    expectValidToolResult(unfiltered);
    expect(Array.isArray(unfiltered.structuredContent.products)).toBe(true);

    const manufacturers = unfiltered.structuredContent.filters?.manufacturers ?? [];

    // The demo catalog may not expose a manufacturer facet in every environment; only assert
    // the narrowing contract when there is a manufacturer to filter by.
    if (manufacturers.length === 0) {
        test.skip(true, 'no manufacturer facet available for the active category');
        return;
    }

    const filtered = await callTool(page, TOOL.filterProducts, {
        limit: 24,
        manufacturerIds: [manufacturers[0].id],
        showResults: false,
    });

    expectValidToolResult(filtered);
    expect(filtered.structuredContent.total).toBeGreaterThan(0);
    expect(filtered.structuredContent.total).toBeLessThanOrEqual(unfiltered.structuredContent.total);
});

test('get_listing_filters → filter_products by a property option (the "red" case) (ACL-132)', async ({ page }) => {
    const vocab = await callTool(page, TOOL.getListingFilters, {});
    const groups = vocab.structuredContent.filters?.properties ?? [];
    const price = vocab.structuredContent.filters?.price;

    // Price aggregation bounds arrive as strings from the Store API; they must be coerced to numbers.
    if (price) {
        expect(typeof price.min === 'number' || price.min === null).toBe(true);
        expect(typeof price.max === 'number' || price.max === null).toBe(true);
    }

    const firstOption = groups.flatMap((group: any) => group.options)[0];

    if (!firstOption) {
        test.skip(true, 'no property facet available for the active category');
        return;
    }

    const filtered = await callTool(page, TOOL.filterProducts, {
        limit: 24,
        propertyOptionIds: [firstOption.id],
        showResults: false,
    });

    expectValidToolResult(filtered);
    expect(Array.isArray(filtered.structuredContent.products)).toBe(true);
    // A concrete property option selects a non-empty subset of the catalog.
    expect(filtered.structuredContent.total).toBeGreaterThan(0);
});

test('filter refines the current search results page without an explicit scope (ACL-132)', async ({ page }) => {
    // The exact shopper flow: on a search results page, "filter for red" must refine THAT search
    // even though the agent passes no categoryId/query — the runtime supplies the active search term.
    await page.goto('/search?search=variant');
    await page.waitForFunction(
        (toolName) => {
            const mc = (document as any).modelContext;
            return !!mc && typeof mc.getTools === 'function' && mc.getTools().some((t: any) => t?.name === toolName);
        },
        TOOL.getListingFilters,
        { timeout: 30_000 },
    );

    const vocab = await callTool(page, TOOL.getListingFilters, {});
    expectValidToolResult(vocab);
    // Scope resolves to the current search, not an error or the whole catalog.
    expect(vocab.structuredContent.scope?.type).toBe('search');
    expect(vocab.structuredContent.scope?.query).toBe('variant');

    const colour = (vocab.structuredContent.filters?.properties ?? []).find((group: any) =>
        /colou?r/i.test(group.group || ''),
    );
    const red = colour?.options.find((option: any) => /red/i.test(option.name));

    if (!red) {
        test.skip(true, 'no red colour option in the search facet for this catalog');
        return;
    }

    const filtered = await callTool(page, TOOL.filterProducts, { propertyOptionIds: [red.id] });
    expectValidToolResult(filtered);
    expect(filtered.structuredContent.scope?.query).toBe('variant');
    expect(filtered.structuredContent.total, 'the red variant should be found in the search').toBeGreaterThan(0);

    // The shopper must SEE it: the tool navigates the browser to the filtered search listing.
    expect(filtered.structuredContent.shownInBrowser).toBe(true);
    expect(String(filtered.structuredContent.listingUrl)).toContain('properties=');
    await page.waitForURL(/[?&]properties=/, { timeout: 15_000 });
    await page.waitForURL(/[?&]search=variant/, { timeout: 15_000 });
});

test('select_variant is page-scoped: absent globally, present on a product page (ACL-132)', async ({ page }) => {
    const registeredOnHome = await page.evaluate(() =>
        ((document as any).modelContext.getTools() as Array<{ name: string }>).map((tool) => tool.name),
    );
    expect(registeredOnHome, 'select_variant must not be advertised off a product page').not.toContain(
        SELECT_VARIANT_TOOL,
    );

    const search = await callTool(page, TOOL.searchProducts, { limit: 1, showResults: false });
    const product = search.structuredContent.products[0];
    expect(product?.url, 'need a product detail url').toBeTruthy();

    await page.goto(product.url);
    await page.waitForFunction(
        (toolName) => {
            const mc = (document as any).modelContext;
            return !!mc && typeof mc.getTools === 'function' && mc.getTools().some((t: any) => t?.name === toolName);
        },
        SELECT_VARIANT_TOOL,
        { timeout: 30_000 },
    );
});

test('select_variant adds the viewed product to the cart (ACL-132)', async ({ page }) => {
    const search = await callTool(page, TOOL.searchProducts, { limit: 1, showResults: false });
    const product = search.structuredContent.products[0];
    expect(product?.url, 'need a product detail url').toBeTruthy();

    await page.goto(product.url);
    await page.waitForFunction(
        (toolName) => {
            const mc = (document as any).modelContext;
            return !!mc && typeof mc.getTools === 'function' && mc.getTools().some((t: any) => t?.name === toolName);
        },
        SELECT_VARIANT_TOOL,
        { timeout: 30_000 },
    );

    // No selections → resolves the product being viewed and adds it, the "add this to my cart" case.
    const result = await callTool(page, SELECT_VARIANT_TOOL, { quantity: 1, showCartOverlay: false });

    expectValidToolResult(result);
    expect(result.structuredContent.addedToCart).toBe(true);
    expect(result.structuredContent.variant?.id, 'a concrete variant/product should be resolved').toBeTruthy();
    expect(result.structuredContent.cart?.itemCount ?? 0).toBeGreaterThan(0);

    await removeFromCart(page, [String(result.structuredContent.variant.id)]);
});

test('select_variant resolves the exact requested option combination (ACL-132)', async ({ page }) => {
    // Regression: "buy the blue in XL" must resolve the real Blue/XL variant, not silently fall
    // back to the currently shown variant (e.g. Blue/M).
    const search = await callTool(page, TOOL.searchProducts, { query: 'variant', limit: 1, showResults: false });
    const product = search.structuredContent.products[0];
    if (!product?.url) {
        test.skip(true, 'no variant product in this catalog');
        return;
    }

    await page.goto(product.url);
    await page.waitForFunction(
        (toolName) => {
            const mc = (document as any).modelContext;
            return !!mc && typeof mc.getTools === 'function' && mc.getTools().some((t: any) => t?.name === toolName);
        },
        SELECT_VARIANT_TOOL,
        { timeout: 30_000 },
    );

    const result = await callTool(page, SELECT_VARIANT_TOOL, {
        selections: [
            { group: 'Colour', option: 'Blue' },
            { group: 'Size', option: 'XL' },
        ],
        addToCart: false,
    });

    expectValidToolResult(result);
    const optionNames = (result.structuredContent.variant?.options ?? []).map((option: any) =>
        String(option.name).toLowerCase(),
    );
    // The resolved variant must actually be Blue AND XL — not the current Blue/M.
    expect(optionNames, `resolved variant options: ${optionNames.join('/')}`).toContain('xl');
    expect(optionNames).toContain('blue');
    expect(optionNames).not.toContain('m');
});
