import {
    cleanText,
    isPlainObject,
    normalizeBaseUrl,
    normalizeSameOriginUrl,
    normalizeUrl,
    uniqueStrings,
} from './tools/storefront-tool.utils.js';

const STORE_API_PATH = '/store-api';
const CONTEXT_TOKEN_HEADER = 'sw-context-token';
const ACCESS_KEY_HEADER = 'sw-access-key';
const CONTEXT_TOKEN_STORAGE_KEY = 'sw-context-token';

export class ShopwareClient {
    constructor(options = {}) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.contextToken = cleanText(options.contextToken) || readContextToken();
        this.accessKey = cleanText(options.accessKey) || readAccessKey();
    }

    async searchProducts({ query, limit }) {
        const result = await this.storeApiRequest('/search', createProductCriteria({
            search: query,
            limit,
        }));
        const products = normalizeProductCollection(result, this.baseUrl);

        return {
            products,
            total: Number.isInteger(result?.total) ? result.total : products.length,
        };
    }

    async findProductBySku(sku) {
        const result = await this.storeApiRequest('/search', createProductCriteria({
            limit: 1,
            filter: [
                {
                    type: 'equals',
                    field: 'productNumber',
                    value: sku,
                },
            ],
        }));
        const products = normalizeProductCollection(result, this.baseUrl);

        if (products.length > 0) {
            return products[0];
        }

        const fallbackResult = await this.searchProducts({ query: sku, limit: 1 });

        return fallbackResult.products[0] || null;
    }

    async getProduct(input = {}) {
        const productId = await this.resolveProductId(input);
        const result = await this.storeApiRequest(`/product/${encodeURIComponent(productId)}`, createProductCriteria({
            limit: 1,
        }));
        const product = normalizeProduct(result?.product || result, this.baseUrl);

        if (!product) {
            throw new Error('No product details were returned by the Shopware Store API.');
        }

        return product;
    }

    async resolveProductId(input = {}) {
        if (cleanText(input.id)) {
            return cleanText(input.id);
        }

        if (cleanText(input.sku)) {
            const product = await this.findProductBySku(cleanText(input.sku));

            if (!product?.id) {
                throw new Error(`No product found for SKU ${input.sku}.`);
            }

            return product.id;
        }

        if (cleanText(input.url)) {
            const productId = productIdFromUrl(input.url, this.baseUrl);

            if (productId) {
                return productId;
            }
        }

        throw new Error('Product lookup requires a Shopware product id, SKU/product number, or /detail/{id} URL.');
    }

    async storeApiRequest(path, body = {}) {
        const url = new URL(`${STORE_API_PATH}${path}`, this.baseUrl);
        const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        };

        if (this.accessKey) {
            headers[ACCESS_KEY_HEADER] = this.accessKey;
        }

        if (this.contextToken) {
            headers[CONTEXT_TOKEN_HEADER] = this.contextToken;
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify(body),
        });
        const responseContextToken = cleanText(response.headers.get(CONTEXT_TOKEN_HEADER));

        if (responseContextToken) {
            this.contextToken = responseContextToken;
            persistContextToken(responseContextToken);
        }

        const payload = await parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(storeApiErrorMessage(response, payload));
        }

        return payload;
    }
}

function createProductCriteria(options = {}) {
    const criteria = {
        associations: {
            cover: {
                associations: {
                    media: {},
                },
            },
            manufacturer: {},
            media: {},
            options: {
                associations: {
                    group: {},
                },
            },
            properties: {
                associations: {
                    group: {},
                },
            },
            seoUrls: {},
            categories: {
                associations: {
                    seoUrls: {},
                },
            },
        },
    };

    if (cleanText(options.search)) {
        criteria.search = cleanText(options.search);
    }

    if (Number.isInteger(options.limit)) {
        criteria.limit = options.limit;
    }

    if (Array.isArray(options.filter) && options.filter.length > 0) {
        criteria.filter = options.filter;
    }

    return criteria;
}

function normalizeProductCollection(result, baseUrl) {
    const elements = Array.isArray(result?.elements)
        ? result.elements
        : isPlainObject(result?.elements) ? Object.values(result.elements) : [];

    return elements
        .map((product) => normalizeProduct(product, baseUrl))
        .filter(Boolean);
}

function normalizeProduct(product, baseUrl) {
    if (!isPlainObject(product)) {
        return null;
    }

    const translated = isPlainObject(product.translated) ? product.translated : {};
    const name = cleanText(translated.name) || cleanText(product.name);

    if (!product.id || !name) {
        return null;
    }

    const calculatedPrice = normalizePrice(product.calculatedPrice || product.calculatedPrices?.[0]);
    const coverImage = normalizeProductImage(product.cover, baseUrl);
    const mediaImages = normalizeMediaImages(product.media, baseUrl);
    const images = uniqueStrings([coverImage, ...mediaImages]);

    return removeEmptyValues({
        id: product.id,
        sku: cleanText(product.productNumber),
        productNumber: cleanText(product.productNumber),
        name,
        description: cleanText(translated.description) || cleanText(product.description),
        manufacturer: normalizeManufacturer(product.manufacturer),
        price: calculatedPrice.formatted,
        priceValue: calculatedPrice.value,
        currency: calculatedPrice.currency,
        active: product.active,
        available: product.available,
        stock: Number.isFinite(product.stock) ? product.stock : null,
        url: normalizeProductUrl(product, baseUrl),
        image: images[0] || null,
        images,
        options: normalizeOptionValues(product.options),
        properties: normalizeOptionValues(product.properties),
        categories: normalizeCategories(product.categories, baseUrl),
    });
}

function normalizeProductUrl(product, baseUrl) {
    const seoUrl = Array.isArray(product.seoUrls)
        ? product.seoUrls.find((candidate) => candidate?.isCanonical) || product.seoUrls[0]
        : null;
    const seoPath = cleanText(seoUrl?.seoPathInfo || seoUrl?.pathInfo);

    if (seoPath) {
        return normalizeUrl(seoPath, baseUrl);
    }

    return normalizeUrl(`/detail/${product.id}`, baseUrl);
}

function normalizePrice(price) {
    if (!isPlainObject(price)) {
        return {};
    }

    const value = typeof price.unitPrice === 'number'
        ? price.unitPrice
        : typeof price.totalPrice === 'number' ? price.totalPrice : null;

    return {
        value,
        currency: cleanText(price.currency?.isoCode) || null,
        formatted: Number.isFinite(value) ? String(value) : null,
    };
}

function normalizeProductImage(cover, baseUrl) {
    const media = cover?.media || cover;

    return normalizeUrl(media?.url, baseUrl);
}

function normalizeMediaImages(mediaCollection, baseUrl) {
    const mediaItems = Array.isArray(mediaCollection)
        ? mediaCollection
        : isPlainObject(mediaCollection?.elements) ? Object.values(mediaCollection.elements) : [];

    return mediaItems.map((item) => normalizeProductImage(item.media || item, baseUrl)).filter(Boolean);
}

function normalizeManufacturer(manufacturer) {
    if (!isPlainObject(manufacturer)) {
        return null;
    }

    const translated = isPlainObject(manufacturer.translated) ? manufacturer.translated : {};

    return cleanText(translated.name) || cleanText(manufacturer.name);
}

function normalizeOptionValues(collection) {
    const items = Array.isArray(collection)
        ? collection
        : isPlainObject(collection?.elements) ? Object.values(collection.elements) : [];

    return items.map((item) => {
        const translated = isPlainObject(item.translated) ? item.translated : {};
        const groupTranslated = isPlainObject(item.group?.translated) ? item.group.translated : {};

        return removeEmptyValues({
            id: item.id,
            name: cleanText(translated.name) || cleanText(item.name),
            group: cleanText(groupTranslated.name) || cleanText(item.group?.name),
        });
    }).filter((item) => item.name);
}

function normalizeCategories(collection, baseUrl) {
    const items = Array.isArray(collection)
        ? collection
        : isPlainObject(collection?.elements) ? Object.values(collection.elements) : [];

    return items.map((category) => {
        const translated = isPlainObject(category.translated) ? category.translated : {};

        return removeEmptyValues({
            id: category.id,
            name: cleanText(translated.name) || cleanText(category.name),
            parentId: cleanText(category.parentId),
            active: category.active,
            url: normalizeCategoryUrl(category, baseUrl),
        });
    }).filter((category) => category.id && category.name);
}

function normalizeCategoryUrl(category, baseUrl) {
    const seoUrl = Array.isArray(category.seoUrls)
        ? category.seoUrls.find((candidate) => candidate?.isCanonical) || category.seoUrls[0]
        : null;
    const seoPath = cleanText(seoUrl?.seoPathInfo || seoUrl?.pathInfo);

    return seoPath ? normalizeUrl(seoPath, baseUrl) : null;
}

function productIdFromUrl(value, baseUrl) {
    const url = normalizeSameOriginUrl(value, baseUrl);

    if (!url) {
        return null;
    }

    const path = new URL(url).pathname;
    const detailMatch = path.match(/\/detail\/([a-f0-9-]{32,36})(?:\/|$)/i);

    return detailMatch?.[1]?.replace(/-/g, '') || null;
}

async function parseJsonResponse(response) {
    const text = await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return {
            raw: text,
        };
    }
}

function storeApiErrorMessage(response, payload) {
    const errorDetail = Array.isArray(payload?.errors)
        ? payload.errors.map((error) => error.detail || error.title).filter(Boolean).join(' ')
        : null;

    if (response.status === 401 || response.status === 403) {
        return errorDetail || 'Shopware Store API request was rejected. The storefront may need an exposed sw-access-key or valid context token.';
    }

    return errorDetail || `Shopware Store API request failed with status ${response.status}.`;
}

function readContextToken() {
    return readKnownValue([
        () => readMetaContent('sw-context-token'),
        () => readStorageValue(CONTEXT_TOKEN_STORAGE_KEY),
        () => readStorageValue('swContextToken'),
        () => readCookieValue(CONTEXT_TOKEN_STORAGE_KEY),
        () => readCookieValue('sw_context_token'),
    ]);
}

function readAccessKey() {
    return readKnownValue([
        () => readMetaContent('sw-access-key'),
        () => readMetaContent('shopware-store-api-access-key'),
        () => window?.storefrontSettings?.storeApi?.accessKey,
        () => window?.storefrontSettings?.salesChannel?.accessKey,
        () => window?.Shopware?.StoreApi?.accessKey,
        () => window?.Shopware?.Context?.accessKey,
        () => window?.swAccessKey,
    ]);
}

function readKnownValue(readers) {
    for (const reader of readers) {
        try {
            const value = cleanText(reader());

            if (value) {
                return value;
            }
        } catch (error) {
            // Ignore inaccessible browser storage.
        }
    }

    return null;
}

function readMetaContent(name) {
    return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
}

function readStorageValue(key) {
    return window.localStorage?.getItem(key) || window.sessionStorage?.getItem(key);
}

function readCookieValue(name) {
    const encodedName = `${encodeURIComponent(name)}=`;
    const cookie = document.cookie
        .split(';')
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(encodedName));

    return cookie ? decodeURIComponent(cookie.slice(encodedName.length)) : null;
}

function persistContextToken(contextToken) {
    try {
        window.localStorage?.setItem(CONTEXT_TOKEN_STORAGE_KEY, contextToken);
    } catch (error) {
        // Ignore inaccessible browser storage.
    }
}

function removeEmptyValues(value) {
    return Object.entries(value).reduce((normalizedValue, [key, item]) => {
        if (item === null || typeof item === 'undefined' || item === '') {
            return normalizedValue;
        }

        if (Array.isArray(item) && item.length === 0) {
            return normalizedValue;
        }

        normalizedValue[key] = item;

        return normalizedValue;
    }, {});
}
