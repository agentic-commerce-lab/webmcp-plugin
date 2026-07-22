import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { boundedString, MAX_PRODUCT_ID_LENGTH } from './schemas';
import { navigateStorefront } from '../navigation';
import type { StorefrontToolOptions } from '../types';

export const FILTER_PRODUCTS_TOOL_NAME = 'shopware_webmcp_filter_products';

const MAX_LISTING_QUERY_LENGTH = 120;
const MAX_FILTER_IDS = 30;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 24;

const filterIdList = z
    .array(boundedString(MAX_PRODUCT_ID_LENGTH, 'Filter id'))
    .max(MAX_FILTER_IDS, `Provide at most ${MAX_FILTER_IDS} ids.`)
    .optional();

const filterNameList = z
    .array(boundedString(120, 'Filter name'))
    .max(MAX_FILTER_IDS, `Provide at most ${MAX_FILTER_IDS} names.`)
    .optional();

const filterProductsInput = z.object({
    categoryId: boundedString(MAX_PRODUCT_ID_LENGTH, 'Category id')
        .describe('Category to filter. Omit to use the listing the shopper is currently viewing.')
        .optional(),
    query: boundedString(MAX_LISTING_QUERY_LENGTH, 'Search query')
        .describe('Search term to filter instead of a category.')
        .optional(),
    manufacturers: filterNameList.describe('Manufacturer names, e.g. "Shopware Fashion" (resolved for you).'),
    propertyOptions: filterNameList.describe('Property/variant option names, e.g. "red", "XL" (resolved for you).'),
    manufacturerIds: filterIdList.describe('Manufacturer ids (alternative to manufacturers).'),
    propertyOptionIds: filterIdList.describe('Property/variant option ids (alternative to propertyOptions).'),
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
    showResults: z.boolean().default(true).describe('Open the filtered listing page (false = data only).'),
});

export function createFilterProductsTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: FILTER_PRODUCTS_TOOL_NAME,
        title: 'Filter products',
        description:
            "Filters a category or search listing by manufacturer, options (colour/size/…), price, rating, shipping and sort; by default opens the filtered listing (showResults:false = data only). Pass manufacturers/propertyOptions by NAME (resolved for you) or *Ids if known. Returns compact cards + remaining `filters`; call get_product for one product's detail. No categoryId/query = the current listing (see `scope`).",
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
                        text: formatResult(result.total, result.listingUrl, showInBrowser),
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

function formatResult(total: number, listingUrl: string | null, showInBrowser: boolean): string {
    // One-line confirmation; the matching rows and remaining facets are in structuredContent for
    // the agent to present, so they are not duplicated into this text channel.
    const shownNote = showInBrowser && listingUrl ? ` Opened the filtered listing for the shopper.` : '';

    return `${total} product${total === 1 ? '' : 's'} match the selected filters (see products).${shownNote}`;
}
