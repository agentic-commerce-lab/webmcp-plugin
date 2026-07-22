import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { boundedString } from './schemas';
import { navigateStorefront } from '../navigation';
import type { ProductSummary, StorefrontToolOptions } from '../types';

export const SEARCH_PRODUCTS_TOOL_NAME = 'shopware_webmcp_search_products';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_QUERY_LENGTH = 120;

const searchProductsInput = z.object({
    query: boundedString(MAX_QUERY_LENGTH, 'Product search query')
        .describe('Optional product search term. Omit or pass an empty string to list products.')
        .optional()
        .transform((value) => (value && value.trim() !== '' ? value : null)),
    limit: z.coerce
        .number()
        .int('Product search limit must be an integer.')
        .min(1, 'Product search limit must be at least 1.')
        .max(MAX_LIMIT, `Product search limit must be at most ${MAX_LIMIT}.`)
        .describe('Maximum number of products to return.')
        .default(DEFAULT_LIMIT),
    showResults: z.boolean().default(true).describe('Open the search results page (false = data only).'),
});

export function createSearchProductsTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: SEARCH_PRODUCTS_TOOL_NAME,
        title: 'Search products',
        description:
            "Searches the catalog; by default opens the search results page for the shopper (omit query to list all; showResults:false = data only). Returns compact product cards (present them too, e.g. a table). For one product's full detail call get_product; to filter by manufacturer/option/price use filter_products.",
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: searchProductsInput,
        execute: async (input) => {
            const searchResult = await shopwareClient.searchProducts(input);
            const showInBrowser = input.showResults && Boolean(searchResult.listingUrl);

            if (showInBrowser && searchResult.listingUrl) {
                navigateStorefront(searchResult.listingUrl);
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: formatProductSearchResult(
                            input.query,
                            searchResult.products,
                            searchResult.listingUrl,
                            showInBrowser,
                        ),
                    },
                ],
                structuredContent: {
                    query: input.query,
                    count: searchResult.products.length,
                    total: searchResult.total,
                    products: searchResult.products,
                    listingUrl: searchResult.listingUrl,
                    shownInBrowser: showInBrowser,
                },
            };
        },
    });
}

function formatProductSearchResult(
    query: string | null,
    products: ProductSummary[],
    listingUrl: string | null,
    showInBrowser: boolean,
): string {
    // One-line confirmation; the product rows live in structuredContent.products for the agent to
    // present (e.g. a table), so they are not duplicated into this text channel.
    const resultLabel = query ? `for "${query}"` : 'without a search term';
    const shownNote = showInBrowser && listingUrl ? ` Opened the results for the shopper.` : '';

    return `Found ${products.length} product${products.length === 1 ? '' : 's'} ${resultLabel} (see products).${shownNote}`;
}
