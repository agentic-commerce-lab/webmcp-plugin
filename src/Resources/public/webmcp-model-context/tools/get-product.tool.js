import {
    cleanText,
    createSearchUrl,
    extractProductsFromSearchHtml,
    fetchStorefrontHtml,
    isPlainObject,
    normalizeBaseUrl,
    normalizeSameOriginUrl,
    normalizeUrl,
    parseHtmlDocument,
    readImageSource,
    uniqueStrings,
} from './storefront-tool.utils.js';

export const GET_PRODUCT_TOOL_NAME = 'shopware.webmcp.get_product';

const MAX_URL_LENGTH = 2048;
const MAX_SKU_LENGTH = 120;

export function createGetProductTool(options = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);

    const execute = async (input = {}) => {
        const normalizedInput = normalizeInput(input, baseUrl);
        const productUrl = normalizedInput.url || await findProductUrlBySku(normalizedInput.sku, baseUrl);
        const html = await fetchStorefrontHtml(productUrl, 'Product fetch');
        const pageDocument = parseHtmlDocument(html, 'Product fetch');
        const product = extractProductFromDocument(pageDocument, productUrl);

        if (!product.name) {
            throw new Error('No product details were found for the provided product reference.');
        }

        return {
            content: [
                {
                    type: 'text',
                    text: formatProductResult(product),
                },
            ],
            structuredContent: {
                lookup: normalizedInput,
                product,
            },
        };
    };

    return {
        name: GET_PRODUCT_TOOL_NAME,
        title: 'Get product',
        description: 'Fetches a Shopware storefront product page and returns product details.',
        inputSchema: {
            type: 'object',
            properties: {
                sku: {
                    type: 'string',
                    maxLength: MAX_SKU_LENGTH,
                    description: 'Product SKU/product number to resolve through storefront search.',
                },
                url: {
                    type: 'string',
                    maxLength: MAX_URL_LENGTH,
                    description: 'Same-origin product URL or path. Defaults to the current page when sku is omitted.',
                },
            },
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function normalizeInput(input, baseUrl) {
    if (!isPlainObject(input)) {
        throw new Error('Get product input must be an object.');
    }

    const rawSku = typeof input.sku === 'string' && input.sku.trim() !== ''
        ? input.sku.trim()
        : null;
    const rawUrl = typeof input.url === 'string' && input.url.trim() !== ''
        ? input.url.trim()
        : null;

    if (rawSku && rawUrl) {
        throw new Error('Get product input must include either sku or url, not both.');
    }

    if (rawSku) {
        return {
            sku: normalizeSku(rawSku),
        };
    }

    return {
        url: normalizeProductUrl(rawUrl || window.location.href, baseUrl),
    };
}

function normalizeProductUrl(rawUrl, baseUrl) {
    if (rawUrl.length > MAX_URL_LENGTH) {
        throw new Error(`Product URL must be ${MAX_URL_LENGTH} characters or fewer.`);
    }

    if (/[\x00-\x1F\x7F]/.test(rawUrl)) {
        throw new Error('Product URL must not contain control characters.');
    }

    const url = normalizeSameOriginUrl(rawUrl, baseUrl);

    if (!url) {
        throw new Error('Product URL must be a same-origin storefront URL or path.');
    }

    return url;
}

function normalizeSku(rawSku) {
    if (rawSku.length > MAX_SKU_LENGTH) {
        throw new Error(`Product SKU must be ${MAX_SKU_LENGTH} characters or fewer.`);
    }

    if (/[\x00-\x1F\x7F]/.test(rawSku)) {
        throw new Error('Product SKU must not contain control characters.');
    }

    return rawSku;
}

async function findProductUrlBySku(sku, baseUrl) {
    const searchUrl = createSearchUrl(baseUrl, sku);
    const html = await fetchStorefrontHtml(searchUrl, 'Product SKU lookup');
    const products = extractProductsFromSearchHtml(html, searchUrl, 1);
    const productUrl = products[0]?.url;

    if (!productUrl) {
        throw new Error(`No product URL found for SKU ${sku}.`);
    }

    return productUrl;
}

function extractProductFromDocument(pageDocument, productUrl) {
    const structuredProduct = extractStructuredProduct(pageDocument, productUrl);
    const domProduct = extractDomProduct(pageDocument, productUrl);
    const product = removeEmptyValues({
        ...structuredProduct,
        ...domProduct,
        url: domProduct.url || structuredProduct.url || productUrl,
        images: mergeUniqueArrays(structuredProduct.images, domProduct.images),
        properties: {
            ...(structuredProduct.properties || {}),
            ...(domProduct.properties || {}),
        },
    });

    if (!Object.keys(product.properties || {}).length) {
        delete product.properties;
    }

    return product;
}

function extractStructuredProduct(pageDocument, productUrl) {
    const productSchema = findProductSchema(pageDocument);

    if (!productSchema) {
        return {};
    }

    const offer = normalizeOffer(productSchema.offers);
    const brand = isPlainObject(productSchema.brand)
        ? productSchema.brand.name
        : productSchema.brand;
    const images = normalizeSchemaImages(productSchema.image, productUrl);

    return removeEmptyValues({
        name: cleanText(productSchema.name),
        description: cleanText(productSchema.description),
        sku: cleanText(productSchema.sku),
        productNumber: cleanText(productSchema.mpn),
        brand: cleanText(brand),
        url: normalizeUrl(productSchema.url, productUrl),
        price: offer.price,
        currency: offer.currency,
        availability: normalizeAvailability(offer.availability),
        images,
    });
}

function normalizeSchemaImages(value, productUrl) {
    const images = Array.isArray(value) ? value : [value];

    return uniqueStrings(images.map((image) => {
        if (isPlainObject(image)) {
            return normalizeUrl(image.url || image.contentUrl, productUrl);
        }

        return normalizeUrl(image, productUrl);
    }));
}

function extractDomProduct(pageDocument, productUrl) {
    const canonicalUrl = normalizeUrl(
        pageDocument.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        productUrl,
    );
    const productName = textFromSelector(
        pageDocument,
        '.product-detail-name, [itemprop="name"], h1',
    );
    const price = textFromSelector(
        pageDocument,
        '.product-detail-price, .product-price, [itemprop="price"]',
    );
    const description = textFromSelector(
        pageDocument,
        '.product-detail-description-text, .product-detail-description, [itemprop="description"]',
    );
    const productNumber = extractProductNumber(pageDocument);
    const manufacturer = textFromSelector(
        pageDocument,
        '.product-detail-manufacturer, .product-detail-manufacturer-link, [itemprop="brand"]',
    );
    const availability = textFromSelector(
        pageDocument,
        '.delivery-information, .product-detail-delivery-information, .delivery-status-indicator, .product-detail-availability',
    );

    return removeEmptyValues({
        name: productName || metaContent(pageDocument, 'og:title'),
        description: description || metaContent(pageDocument, 'og:description') || metaContent(pageDocument, 'description'),
        productNumber,
        brand: manufacturer,
        price,
        availability,
        url: canonicalUrl || normalizeUrl(productUrl, productUrl),
        images: extractImages(pageDocument, productUrl),
        breadcrumbs: extractBreadcrumbs(pageDocument),
        properties: extractProperties(pageDocument),
        addToCartAvailable: Boolean(pageDocument.querySelector('form[action*="/checkout/line-item/add"]')),
    });
}

function findProductSchema(pageDocument) {
    const scriptElements = Array.from(pageDocument.querySelectorAll('script[type="application/ld+json"]'));

    for (const scriptElement of scriptElements) {
        const schema = parseJson(scriptElement.textContent);
        const productSchema = findProductSchemaValue(schema);

        if (productSchema) {
            return productSchema;
        }
    }

    return null;
}

function findProductSchemaValue(value) {
    if (Array.isArray(value)) {
        for (const item of value) {
            const productSchema = findProductSchemaValue(item);

            if (productSchema) {
                return productSchema;
            }
        }

        return null;
    }

    if (!isPlainObject(value)) {
        return null;
    }

    if (schemaTypeMatches(value['@type'], 'Product')) {
        return value;
    }

    if (Array.isArray(value['@graph'])) {
        return findProductSchemaValue(value['@graph']);
    }

    return null;
}

function schemaTypeMatches(type, expectedType) {
    if (Array.isArray(type)) {
        return type.some((item) => schemaTypeMatches(item, expectedType));
    }

    return typeof type === 'string' && type.toLowerCase() === expectedType.toLowerCase();
}

function normalizeOffer(offers) {
    const offer = Array.isArray(offers) ? offers[0] : offers;

    if (!isPlainObject(offer)) {
        return {};
    }

    return {
        price: cleanText(String(offer.price ?? offer.lowPrice ?? '')),
        currency: cleanText(offer.priceCurrency),
        availability: cleanText(offer.availability),
    };
}

function normalizeAvailability(value) {
    const availability = cleanText(value);

    return availability ? availability.split('/').pop() : null;
}

function extractProductNumber(pageDocument) {
    const orderNumberElement = pageDocument.querySelector(
        '.product-detail-ordernumber, .product-detail-product-number, [itemprop="sku"], [itemprop="mpn"]',
    );
    const orderNumberText = cleanText(orderNumberElement?.getAttribute('content'))
        || cleanText(orderNumberElement?.textContent);

    if (!orderNumberText) {
        return null;
    }

    return orderNumberText.replace(/^product\s*(number|no\.?|id)?\s*:?\s*/i, '').trim() || orderNumberText;
}

function extractImages(pageDocument, productUrl) {
    const imageElements = Array.from(pageDocument.querySelectorAll(
        '.gallery-slider-image, .product-detail-media img, img[itemprop="image"], meta[property="og:image"]',
    ));
    const imageUrls = imageElements.map((imageElement) => {
        const source = imageElement.tagName.toLowerCase() === 'meta'
            ? imageElement.getAttribute('content')
            : readImageSource(imageElement);

        return normalizeUrl(source, productUrl);
    });

    return uniqueStrings(imageUrls).slice(0, 8);
}

function extractBreadcrumbs(pageDocument) {
    const breadcrumbElements = Array.from(pageDocument.querySelectorAll(
        '.breadcrumb-item, .breadcrumb a, nav[aria-label*="breadcrumb" i] a',
    ));

    return uniqueStrings(breadcrumbElements.map((element) => element.textContent));
}

function extractProperties(pageDocument) {
    const properties = {};
    const rows = Array.from(pageDocument.querySelectorAll(
        '.product-detail-properties-table tr, .product-detail-properties .product-detail-properties-row',
    ));

    rows.forEach((row) => {
        const label = cleanText(
            row.querySelector('th, .product-detail-properties-label')?.textContent,
        );
        const value = cleanText(
            row.querySelector('td, .product-detail-properties-value')?.textContent,
        );

        if (label && value) {
            properties[label.replace(/:$/, '')] = value;
        }
    });

    return properties;
}

function textFromSelector(pageDocument, selector) {
    return cleanText(pageDocument.querySelector(selector)?.getAttribute('content'))
        || cleanText(pageDocument.querySelector(selector)?.textContent);
}

function metaContent(pageDocument, name) {
    const selector = name.startsWith('og:')
        ? `meta[property="${name}"]`
        : `meta[name="${name}"]`;

    return cleanText(pageDocument.querySelector(selector)?.getAttribute('content'));
}

function formatProductResult(product) {
    const lines = [
        product.name,
        product.price ? `Price: ${product.price}${product.currency ? ` ${product.currency}` : ''}` : null,
        product.availability ? `Availability: ${product.availability}` : null,
        product.productNumber ? `Product number: ${product.productNumber}` : null,
        product.brand ? `Brand: ${product.brand}` : null,
        product.url,
        product.description ? `Description: ${product.description}` : null,
    ].filter(Boolean);

    return lines.join('\n');
}

function mergeUniqueArrays(firstValue, secondValue) {
    return uniqueStrings([
        ...(Array.isArray(firstValue) ? firstValue : []),
        ...(Array.isArray(secondValue) ? secondValue : []),
    ]);
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

function parseJson(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}
