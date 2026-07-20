import {
    cleanText,
    isPlainObject,
    normalizeSameOriginUrl,
    normalizeUrl,
    removeEmptyValues,
    uniqueStrings,
} from '../tools/storefront-tool.utils';
import type { ProductSummary, UnknownRecord } from '../types';
import { normalizeCategories } from './category';

export function createProductCriteria(options: UnknownRecord = {}): UnknownRecord {
    const criteria: UnknownRecord = {
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

export function normalizeProductCollection(result: any, baseUrl: string): ProductSummary[] {
    const elements = Array.isArray(result?.elements)
        ? result.elements
        : isPlainObject(result?.elements)
          ? Object.values(result.elements)
          : [];

    return elements
        .map((product: any) => normalizeProduct(product, baseUrl))
        .filter((product: ProductSummary | null): product is ProductSummary => Boolean(product));
}

export function normalizeProduct(product: any, baseUrl: string): ProductSummary | null {
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
    }) as ProductSummary;
}

function normalizeProductUrl(product: any, baseUrl: string): string | null {
    const seoUrl = Array.isArray(product.seoUrls)
        ? product.seoUrls.find((candidate: any) => candidate?.isCanonical) || product.seoUrls[0]
        : null;
    const seoPath = cleanText(seoUrl?.seoPathInfo || seoUrl?.pathInfo);

    if (seoPath) {
        return normalizeUrl(seoPath, baseUrl);
    }

    return normalizeUrl(`/detail/${product.id}`, baseUrl);
}

function normalizePrice(price: any): { value?: number | null; currency?: string | null; formatted?: string | null } {
    if (!isPlainObject(price)) {
        return {};
    }

    const value =
        typeof price.unitPrice === 'number'
            ? price.unitPrice
            : typeof price.totalPrice === 'number'
              ? price.totalPrice
              : null;

    return {
        value,
        currency: cleanText(price.currency?.isoCode) || null,
        formatted: Number.isFinite(value) ? String(value) : null,
    };
}

function normalizeProductImage(cover: any, baseUrl: string): string | null {
    const media = cover?.media || cover;

    return normalizeUrl(media?.url, baseUrl);
}

function normalizeMediaImages(mediaCollection: any, baseUrl: string): string[] {
    const mediaItems = Array.isArray(mediaCollection)
        ? mediaCollection
        : isPlainObject(mediaCollection?.elements)
          ? Object.values(mediaCollection.elements)
          : [];

    return mediaItems
        .map((item) => normalizeProductImage(item.media || item, baseUrl))
        .filter((url): url is string => Boolean(url));
}

function normalizeManufacturer(manufacturer: any): string | null {
    if (!isPlainObject(manufacturer)) {
        return null;
    }

    const translated = isPlainObject(manufacturer.translated) ? manufacturer.translated : {};

    return cleanText(translated.name) || cleanText(manufacturer.name);
}

function normalizeOptionValues(collection: any): UnknownRecord[] {
    const items = Array.isArray(collection)
        ? collection
        : isPlainObject(collection?.elements)
          ? Object.values(collection.elements)
          : [];

    return items
        .map((item) => {
            const translated = isPlainObject(item.translated) ? item.translated : {};
            const groupTranslated = isPlainObject(item.group?.translated) ? item.group.translated : {};

            return removeEmptyValues({
                id: item.id,
                name: cleanText(translated.name) || cleanText(item.name),
                group: cleanText(groupTranslated.name) || cleanText(item.group?.name),
            });
        })
        .filter((item) => item.name);
}

export function productIdFromUrl(value: unknown, baseUrl: string): string | null {
    const url = normalizeSameOriginUrl(value, baseUrl);

    if (!url) {
        return null;
    }

    const path = new URL(url).pathname;
    const detailMatch = path.match(/\/detail\/([a-f0-9-]{32,36})(?:\/|$)/i);

    return detailMatch?.[1]?.replace(/-/g, '') || null;
}
