import type { UnknownRecord, WebMcpRuntimeConfig } from './types';
import { hasControlCharacters } from './tools/storefront-tool.utils';

export function normalizeConfig(options: unknown = {}): WebMcpRuntimeConfig {
    const source = isPlainObject(options) ? options : {};
    const tools = isPlainObject(source.tools) ? source.tools : {};

    return {
        enabled: booleanOption(source.enabled, true),
        baseUrl: nonEmptyString(source.baseUrl),
        storeApiAccessKey: nonEmptyString(source.storeApiAccessKey),
        navigationCategoryId: nonEmptyString(source.navigationCategoryId),
        activeCategoryId: nonEmptyString(source.activeCategoryId),
        currentProductId: nonEmptyString(source.currentProductId),
        tools: {
            searchProducts: booleanOption(tools.searchProducts, true),
            getProduct: booleanOption(tools.getProduct, true),
            getProductCategories: booleanOption(tools.getProductCategories, true),
            getCart: booleanOption(tools.getCart, true),
            addToCart: booleanOption(tools.addToCart, true),
            updateLineItem: booleanOption(tools.updateLineItem, true),
            getSalesChannelContext: booleanOption(tools.getSalesChannelContext, true),
            navigate: booleanOption(tools.navigate, true),
        },
    };
}

export function currentBaseUrl(configuredBaseUrl: unknown): string {
    const fallbackBaseUrl = window.location.origin.replace(/\/+$/, '');

    if (!configuredBaseUrl) {
        return fallbackBaseUrl;
    }

    if (typeof configuredBaseUrl !== 'string') {
        return fallbackBaseUrl;
    }

    try {
        return new URL(configuredBaseUrl, fallbackBaseUrl).origin.replace(/\/+$/, '');
    } catch (error) {
        return fallbackBaseUrl;
    }
}

export function parseJson(value: unknown): unknown {
    const json = nonEmptyString(value);

    if (!json) {
        return null;
    }

    try {
        return JSON.parse(json);
    } catch (error) {
        return null;
    }
}

function booleanOption(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value === 1;
    }

    if (typeof value === 'string') {
        switch (value.trim().toLowerCase()) {
            case '1':
            case 'true':
            case 'yes':
            case 'on':
                return true;
            case '0':
            case 'false':
            case 'no':
            case 'off':
                return false;
            default:
                return fallback;
        }
    }

    return fallback;
}

export function safeString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    if (!trimmed || hasControlCharacters(trimmed)) {
        return null;
    }

    return trimmed;
}

export function nonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    return trimmed || null;
}

export function isPlainObject(value: unknown): value is UnknownRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isElement(value: unknown): value is Element {
    return (
        Boolean(value) &&
        typeof value === 'object' &&
        value !== null &&
        'nodeType' in value &&
        (value as Node).nodeType === Node.ELEMENT_NODE
    );
}
