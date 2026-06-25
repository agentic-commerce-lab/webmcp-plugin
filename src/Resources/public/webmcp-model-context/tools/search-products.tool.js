import {
    createSearchUrl,
    extractProductsFromSearchHtml,
    fetchStorefrontHtml,
    isPlainObject,
    normalizeBaseUrl,
} from './storefront-tool.utils.js';

export const SEARCH_PRODUCTS_TOOL_NAME = 'shopware.webmcp.search_products';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_QUERY_LENGTH = 120;

export function createSearchProductsTool(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);

    const execute = async (input = {}) => {
        const normalizedInput = normalizeInput(input);
        const searchUrl = createSearchUrl(baseUrl, normalizedInput.query);
        const html = await fetchStorefrontHtml(searchUrl, 'Product search');
        const products = extractProductsFromSearchHtml(html, searchUrl, normalizedInput.limit);

        return {
            content: [
                {
                    type: 'text',
                    text: formatProductSearchResult(normalizedInput.query, products),
                },
            ],
            structuredContent: {
                query: normalizedInput.query,
                count: products.length,
                products,
            },
        };
    };

    return {
        name: SEARCH_PRODUCTS_TOOL_NAME,
        title: 'Search products',
        description: 'Searches the Shopware storefront and returns matching product summaries.',
        inputSchema: {
            type: 'object',
            required: ['query'],
            properties: {
                query: {
                    type: 'string',
                    minLength: 1,
                    maxLength: MAX_QUERY_LENGTH,
                    description: 'Product search term.',
                },
                limit: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_LIMIT,
                    default: DEFAULT_LIMIT,
                    description: 'Maximum number of products to return.',
                },
            },
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function formatProductSearchResult(query, products) {
    if (products.length === 0) {
        return `No products found for "${query}".`;
    }

    const lines = products.map((product, index) => {
        const details = [product.price, product.url].filter(Boolean).join(' - ');

        return `${index + 1}. ${product.name}${details ? ` - ${details}` : ''}`;
    });

    return `Found ${products.length} product${products.length === 1 ? '' : 's'} for "${query}":\n${lines.join('\n')}`;
}

function normalizeInput(input) {
    if (!isPlainObject(input)) {
        throw new Error('Product search input must be an object.');
    }

    return {
        query: normalizeQuery(input.query),
        limit: normalizeLimit(input.limit),
    };
}

function normalizeQuery(value) {
    if (typeof value !== 'string') {
        throw new Error('Product search query must be a string.');
    }

    const query = value.trim();

    if (!query || /[\x00-\x1F\x7F]/.test(query)) {
        throw new Error('Product search query must be non-empty text.');
    }

    if (query.length > MAX_QUERY_LENGTH) {
        throw new Error(`Product search query must be ${MAX_QUERY_LENGTH} characters or fewer.`);
    }

    return query;
}

function normalizeLimit(value) {
    if (typeof value === 'undefined' || value === null) {
        return DEFAULT_LIMIT;
    }

    const limit = typeof value === 'number' ? value : Number(value);

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new Error(`Product search limit must be an integer between 1 and ${MAX_LIMIT}.`);
    }

    return limit;
}
