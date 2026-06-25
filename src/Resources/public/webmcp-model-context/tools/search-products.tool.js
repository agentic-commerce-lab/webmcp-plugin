export const SEARCH_PRODUCTS_TOOL_NAME = 'shopware.webmcp.search_products';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_QUERY_LENGTH = 120;

export function createSearchProductsTool(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);

    const execute = async (input = {}) => {
        const normalizedInput = normalizeInput(input);
        const searchUrl = createSearchUrl(baseUrl, normalizedInput.query);
        const html = await fetchSearchHtml(searchUrl);
        const products = extractProductsFromHtml(html, searchUrl, normalizedInput.limit);

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

async function fetchSearchHtml(searchUrl) {
    if (typeof fetch !== 'function') {
        throw new Error('Product search requires the browser fetch API.');
    }

    const response = await fetch(searchUrl.toString(), {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
            Accept: 'text/html,application/xhtml+xml',
        },
    });

    if (!response.ok) {
        throw new Error(`Product search failed with status ${response.status}.`);
    }

    return response.text();
}

function extractProductsFromHtml(html, searchUrl, limit) {
    if (typeof DOMParser !== 'function') {
        throw new Error('Product search requires the browser DOMParser API.');
    }

    const documentFragment = new DOMParser().parseFromString(html, 'text/html');
    const productElements = findProductElements(documentFragment);
    const products = [];
    const seenProducts = new Set();

    for (const productElement of productElements) {
        const product = normalizeProduct(productElement, searchUrl);

        if (!product) {
            continue;
        }

        const productKey = product.url || product.name.toLowerCase();
        if (seenProducts.has(productKey)) {
            continue;
        }

        seenProducts.add(productKey);
        products.push(product);

        if (products.length >= limit) {
            break;
        }
    }

    return products;
}

function findProductElements(documentFragment) {
    const primaryMatches = Array.from(documentFragment.querySelectorAll('.product-box'));

    if (primaryMatches.length > 0) {
        return primaryMatches;
    }

    return Array.from(documentFragment.querySelectorAll('[itemtype*="Product"], [data-product-information]'));
}

function normalizeProduct(productElement, searchUrl) {
    const linkElement = findProductLink(productElement);
    const nameElement = productElement.querySelector('.product-name, [itemprop="name"], a[title]');
    const name = cleanText(nameElement?.textContent)
        || cleanText(nameElement?.getAttribute('title'))
        || cleanText(linkElement?.getAttribute('title'))
        || cleanText(linkElement?.textContent);

    if (!name) {
        return null;
    }

    const priceElement = productElement.querySelector('.product-price, .product-price-wrapper, [itemprop="price"]');
    const imageElement = productElement.querySelector('img.product-image, img[itemprop="image"], img');
    const product = {
        name,
    };
    const url = normalizeUrl(linkElement?.getAttribute('href'), searchUrl);
    const price = cleanText(priceElement?.getAttribute('content')) || cleanText(priceElement?.textContent);
    const image = normalizeUrl(readImageSource(imageElement), searchUrl);

    if (url) {
        product.url = url;
    }

    if (price) {
        product.price = price;
    }

    if (image) {
        product.image = image;
    }

    return product;
}

function findProductLink(productElement) {
    return productElement.querySelector(
        'a.product-name[href], .product-name a[href], a.product-image-link[href], a[href*="/detail/"], a[href]',
    );
}

function readImageSource(imageElement) {
    if (!imageElement) {
        return null;
    }

    return imageElement.getAttribute('src')
        || imageElement.getAttribute('data-src')
        || firstSrcsetUrl(imageElement.getAttribute('srcset'))
        || firstSrcsetUrl(imageElement.getAttribute('data-srcset'));
}

function firstSrcsetUrl(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const firstCandidate = value.split(',')[0]?.trim();

    return firstCandidate ? firstCandidate.split(/\s+/)[0] : null;
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

function createSearchUrl(baseUrl, query) {
    const searchUrl = new URL('/search', baseUrl);

    searchUrl.searchParams.set('search', query);

    return searchUrl;
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

function normalizeUrl(value, baseUrl) {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    try {
        return new URL(value, baseUrl).toString();
    } catch (error) {
        return null;
    }
}

function normalizeBaseUrl(value) {
    const fallbackBaseUrl = window.location.origin.replace(/\/+$/, '');

    if (typeof value !== 'string' || value.trim() === '') {
        return fallbackBaseUrl;
    }

    try {
        return new URL(value, fallbackBaseUrl).origin.replace(/\/+$/, '');
    } catch (error) {
        return fallbackBaseUrl;
    }
}

function cleanText(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const text = value.replace(/\s+/g, ' ').trim();

    return text || null;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
