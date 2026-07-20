import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { boundedString } from './schemas';
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
});

export function createSearchProductsTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: SEARCH_PRODUCTS_TOOL_NAME,
        title: 'Search products',
        description: 'Searches the storefront catalog. Omit query to list products.',
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        input: searchProductsInput,
        execute: async (input) => {
            const searchResult = await shopwareClient.searchProducts(input);

            return {
                content: [{ type: 'text', text: formatProductSearchResult(input.query, searchResult.products) }],
                structuredContent: {
                    query: input.query,
                    count: searchResult.products.length,
                    total: searchResult.total,
                    products: searchResult.products,
                },
            };
        },
    });
}

function formatProductSearchResult(query: string | null, products: ProductSummary[]): string {
    const resultLabel = query ? `for "${query}"` : 'without a search term';

    if (products.length === 0) {
        return `No products found ${resultLabel}.`;
    }

    const lines = products.map((product, index) => {
        const details = [product.price, product.url].filter(Boolean).join(' - ');

        return `${index + 1}. ${product.name}${details ? ` - ${details}` : ''}`;
    });

    return `Found ${products.length} product${products.length === 1 ? '' : 's'} ${resultLabel}:\n${lines.join('\n')}`;
}
