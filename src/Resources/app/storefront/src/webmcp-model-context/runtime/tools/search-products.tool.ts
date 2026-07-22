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
    showResults: z
        .boolean()
        .default(true)
        .describe(
            "Navigate the shopper to the storefront search results page so they see the results in their browser (only when a query is given). This runs in the shopper's own tab, so keep it true when the shopper asked to search/see products; set false to only fetch data for reasoning (e.g. to answer a question or pick a product id).",
        ),
});

export function createSearchProductsTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: SEARCH_PRODUCTS_TOOL_NAME,
        title: 'Search products',
        description:
            'Searches the storefront catalog and, by default, navigates the shopper to the search results page so they see it. It ALSO returns the matching `products` — present these back to the shopper too (e.g. as a table) so they get the answer in chat as well as on the page. Omit query to just list products as data. Set showResults false to fetch results as data without moving the page (e.g. to answer a question or resolve a product id). To also filter by manufacturer/property/price, use filter_products.',
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
    const resultLabel = query ? `for "${query}"` : 'without a search term';
    // Always list the products (both channels) so the agent can present them, plus a note when
    // the shopper was also taken to the search results page.
    const shownNote = showInBrowser && listingUrl ? ` Opened the search results for the shopper: ${listingUrl}` : '';

    if (products.length === 0) {
        return `No products found ${resultLabel}.${shownNote}`;
    }

    const lines = products.map((product, index) => {
        const details = [
            product.price ? `${product.price}${product.currency ? ` ${product.currency}` : ''}` : null,
            product.url,
        ]
            .filter(Boolean)
            .join(' - ');

        return `${index + 1}. ${product.name}${details ? ` - ${details}` : ''}`;
    });

    return `Found ${products.length} product${products.length === 1 ? '' : 's'} ${resultLabel}:\n${lines.join('\n')}${shownNote}`;
}
