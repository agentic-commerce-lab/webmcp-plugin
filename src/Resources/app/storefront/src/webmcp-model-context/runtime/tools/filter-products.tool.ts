import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { boundedString, MAX_PRODUCT_ID_LENGTH } from './schemas';
import { navigateStorefront } from '../navigation';
import type { ProductSummary, StorefrontToolOptions } from '../types';

export const FILTER_PRODUCTS_TOOL_NAME = 'shopware_webmcp_filter_products';

const MAX_LISTING_QUERY_LENGTH = 120;
const MAX_FILTER_IDS = 30;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 24;

const filterIdList = z
    .array(boundedString(MAX_PRODUCT_ID_LENGTH, 'Filter id'))
    .max(MAX_FILTER_IDS, `Provide at most ${MAX_FILTER_IDS} ids.`)
    .optional();

const filterProductsInput = z.object({
    categoryId: boundedString(MAX_PRODUCT_ID_LENGTH, 'Category id')
        .describe('Category to filter. Omit to use the listing the shopper is currently viewing.')
        .optional(),
    query: boundedString(MAX_LISTING_QUERY_LENGTH, 'Search query')
        .describe('Search term to filter instead of a category.')
        .optional(),
    manufacturerIds: filterIdList.describe('Manufacturer ids from get_listing_filters.'),
    propertyOptionIds: filterIdList.describe(
        'Property/variant option ids from get_listing_filters (e.g. the id for "red").',
    ),
    priceMin: z.coerce.number().min(0).describe('Minimum price.').optional(),
    priceMax: z.coerce.number().min(0).describe('Maximum price.').optional(),
    minRating: z.coerce.number().int().min(1).max(5).describe('Minimum star rating (1-5).').optional(),
    shippingFree: z.boolean().describe('Only free-shipping products when true.').optional(),
    sort: boundedString(64, 'Sort key')
        .describe('Sort order key from get_listing_filters (e.g. price-asc).')
        .optional(),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_LIMIT, `Limit must be at most ${MAX_LIMIT}.`)
        .describe('Maximum number of products to return.')
        .default(DEFAULT_LIMIT),
    page: z.coerce.number().int().min(1).describe('1-based result page.').default(1),
    showResults: z
        .boolean()
        .default(true)
        .describe(
            "Navigate the shopper to the filtered listing page so they see the result in their browser (search or category listings). This runs in the shopper's own tab, so keep it true in interactive sessions; set false for headless automation or to only fetch data.",
        ),
});

export function createFilterProductsTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: FILTER_PRODUCTS_TOOL_NAME,
        title: 'Filter products',
        description:
            'Filters a category or search listing by manufacturer, property/variant options (color, size, …), price, rating, shipping and sort order, and by default navigates the shopper to the filtered listing so they see it in their browser. It ALSO returns the matching `products` and the still-available `filters` — present these back to the shopper too (e.g. as a table) so they get the answer in chat as well as on the page. Use get_listing_filters first to resolve option ids. With no categoryId or query it filters the listing the shopper is currently viewing (the active category, or the current search results); the returned `scope` says which listing was filtered.',
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: filterProductsInput,
        execute: async (input) => {
            const result = await shopwareClient.filterProducts(input);
            const showInBrowser = input.showResults && Boolean(result.listingUrl);

            if (showInBrowser && result.listingUrl) {
                navigateStorefront(result.listingUrl);
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: formatResult(result.total, result.products, result.listingUrl, showInBrowser),
                    },
                ],
                structuredContent: {
                    scope: result.scope,
                    count: result.products.length,
                    total: result.total,
                    products: result.products,
                    filters: result.facets,
                    listingUrl: result.listingUrl,
                    shownInBrowser: showInBrowser,
                },
            };
        },
    });
}

function formatResult(
    total: number,
    products: ProductSummary[],
    listingUrl: string | null,
    showInBrowser: boolean,
): string {
    const countLabel = `${total} product${total === 1 ? '' : 's'} match the selected filters`;
    // Whether or not the page was navigated, always list the products so the agent has them in
    // both channels (text + structuredContent) to also present to the shopper, e.g. as a table.
    const shownNote = showInBrowser && listingUrl ? ` Opened the filtered listing for the shopper: ${listingUrl}` : '';

    if (products.length === 0) {
        return `No products match the selected filters.${shownNote}`;
    }

    const lines = products.map((product, index) => formatProductLine(product, index));
    const hint = shownNote || (listingUrl ? `\nOpen ${listingUrl} to view them on the page.` : '');

    return `${countLabel}; here are ${products.length} for you to present:\n${lines.join('\n')}${hint}`;
}

function formatProductLine(product: ProductSummary, index: number): string {
    const details = [
        product.price ? `${product.price}${product.currency ? ` ${product.currency}` : ''}` : null,
        product.url,
    ]
        .filter(Boolean)
        .join(' - ');

    return `${index + 1}. ${product.name}${details ? ` - ${details}` : ''}`;
}
