/**
 * Benchmark configuration.
 *
 * Fill these in for your demo shop (or override via env vars, same names).
 * All product/category values must match real data in the shop the
 * benchmark runs against, otherwise the success checks cannot pass.
 */
export const config = {
    baseUrl: process.env.SHOP_BASE_URL ?? 'http://localhost:8080',

    // Task 1: open a category
    categoryName: process.env.CATEGORY_NAME ?? 'Clothing',
    categoryUrl: process.env.CATEGORY_URL ?? '/Clothing/',

    // Task 2: open two products from that category
    productAName: process.env.PRODUCT_A_NAME ?? '',
    productAUrl: process.env.PRODUCT_A_URL ?? '',
    productBName: process.env.PRODUCT_B_NAME ?? '',
    productBUrl: process.env.PRODUCT_B_URL ?? '',

    // Task 3: search for a product
    searchTerm: process.env.SEARCH_TERM ?? '',
    searchResultName: process.env.SEARCH_RESULT_NAME ?? '',

    // Task 4: filter products (human description + expected result substring)
    filterDescription: process.env.FILTER_DESCRIPTION ?? 'only products cheaper than 50 EUR',
    filterExpect: process.env.FILTER_EXPECT ?? '',

    // Task 5: open a specific PDP
    pdpProductName: process.env.PDP_PRODUCT_NAME ?? '',
    pdpProductUrl: process.env.PDP_PRODUCT_URL ?? '',

    // Task 6: add a specific variant to the cart.
    // variantProductId is the Shopware UUID of the concrete variant
    // (ground truth checked against GET /webmcp/cart).
    variantProductName: process.env.VARIANT_PRODUCT_NAME ?? '',
    variantDescription: process.env.VARIANT_DESCRIPTION ?? 'size M, color red',
    variantProductId: process.env.VARIANT_PRODUCT_ID ?? '',
    variantQuantity: Number(process.env.VARIANT_QUANTITY ?? '1'),

    // Experiment parameters
    maxSteps: Number(process.env.MAX_STEPS ?? '30'),
    taskTimeoutMs: Number(process.env.TASK_TIMEOUT_MS ?? '300000'),
    runs: Number(process.env.RUNS ?? '5'),
};
