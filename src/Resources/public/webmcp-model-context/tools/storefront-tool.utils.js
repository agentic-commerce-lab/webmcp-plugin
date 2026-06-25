export function normalizeBaseUrl(value) {
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

export function normalizeUrl(value, baseUrl) {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    try {
        return new URL(value, baseUrl).toString();
    } catch (error) {
        return null;
    }
}

export function normalizeSameOriginUrl(value, baseUrl) {
    const url = normalizeUrl(value, baseUrl);

    if (!url) {
        return null;
    }

    try {
        const parsedUrl = new URL(url);
        const parsedBaseUrl = new URL(baseUrl);

        return parsedUrl.origin === parsedBaseUrl.origin ? parsedUrl.toString() : null;
    } catch (error) {
        return null;
    }
}

export async function fetchStorefrontHtml(url, label = 'Storefront request') {
    if (typeof fetch !== 'function') {
        throw new Error(`${label} requires the browser fetch API.`);
    }

    const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
            Accept: 'text/html,application/xhtml+xml',
        },
    });

    if (!response.ok) {
        throw new Error(`${label} failed with status ${response.status}.`);
    }

    return response.text();
}

export function parseHtmlDocument(html, label = 'HTML parsing') {
    if (typeof DOMParser !== 'function') {
        throw new Error(`${label} requires the browser DOMParser API.`);
    }

    return new DOMParser().parseFromString(html, 'text/html');
}

export function readImageSource(imageElement) {
    if (!imageElement) {
        return null;
    }

    return imageElement.getAttribute('src')
        || imageElement.getAttribute('data-src')
        || firstSrcsetUrl(imageElement.getAttribute('srcset'))
        || firstSrcsetUrl(imageElement.getAttribute('data-srcset'));
}

export function createSearchUrl(baseUrl, query) {
    const searchUrl = new URL('/search', baseUrl);

    searchUrl.searchParams.set('search', query);

    return searchUrl;
}

export function extractProductsFromSearchHtml(html, searchUrl, limit) {
    const documentFragment = parseHtmlDocument(html, 'Product search');
    const productElements = findProductElements(documentFragment);
    const products = [];
    const seenProducts = new Set();

    for (const productElement of productElements) {
        const product = normalizeProductSummary(productElement, searchUrl);

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

export function cleanText(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const text = value.replace(/\s+/g, ' ').trim();

    return text || null;
}

export function uniqueStrings(values) {
    const seenValues = new Set();
    const normalizedValues = [];

    values.forEach((value) => {
        const normalizedValue = cleanText(value);

        if (!normalizedValue || seenValues.has(normalizedValue)) {
            return;
        }

        seenValues.add(normalizedValue);
        normalizedValues.push(normalizedValue);
    });

    return normalizedValues;
}

export function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstSrcsetUrl(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const firstCandidate = value.split(',')[0]?.trim();

    return firstCandidate ? firstCandidate.split(/\s+/)[0] : null;
}

function findProductElements(documentFragment) {
    const primaryMatches = Array.from(documentFragment.querySelectorAll('.product-box'));

    if (primaryMatches.length > 0) {
        return primaryMatches;
    }

    return Array.from(documentFragment.querySelectorAll('[itemtype*="Product"], [data-product-information]'));
}

function normalizeProductSummary(productElement, searchUrl) {
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
