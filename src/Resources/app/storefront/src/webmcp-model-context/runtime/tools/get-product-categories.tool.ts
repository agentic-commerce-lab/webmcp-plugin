import { ShopwareClient } from '../shopware-client';
import {
    cleanText,
    isPlainObject,
    normalizeBaseUrl,
    normalizeOptionalStringField,
    normalizeSameOriginUrl,
} from './storefront-tool.utils';
import type { ProductLookupInput, StorefrontToolOptions, UnknownRecord } from '../types';

export const GET_PRODUCT_CATEGORIES_TOOL_NAME = 'shopware_webmcp_get_product_categories';

const MAX_PRODUCT_ID_LENGTH = 64;
const MAX_SKU_LENGTH = 120;
const MAX_URL_LENGTH = 2048;
const VALID_SCOPES = ['tree', 'product'] as const;
const NAVIGATION_TREE_DEPTH = 2;

type CategoryScope = (typeof VALID_SCOPES)[number];

interface CategoryInput extends ProductLookupInput {
    scope: CategoryScope;
}

export function createGetProductCategoriesTool(options: StorefrontToolOptions = {}) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const shopwareClient = new ShopwareClient(options);

    const execute = async (input = {}) => {
        const normalizedInput = normalizeInput(input, baseUrl);
        const tree = normalizedInput.scope === 'product'
            ? await shopwareClient.getProductCategories(normalizedInput)
            : await shopwareClient.getNavigationCategories(NAVIGATION_TREE_DEPTH);
        const result = buildCategoryResult(normalizedInput.scope, baseUrl, tree);

        return {
            content: [
                {
                    type: 'text',
                    text: formatCategoryResult(result),
                },
            ],
            structuredContent: {
                lookup: normalizedInput,
                ...result,
            },
        };
    };

    return {
        name: GET_PRODUCT_CATEGORIES_TOOL_NAME,
        title: 'Get product categories',
        description: 'Returns the storefront navigation category tree (with the currently viewed category and its ancestors marked active), or the categories a product belongs to, from the Shopware Store API. For product scope provide a product id, sku, or url, or omit them to use the product page the shopper is currently viewing.',
        inputSchema: {
            type: 'object',
            properties: {
                scope: {
                    type: 'string',
                    enum: [...VALID_SCOPES],
                    default: 'tree',
                    description: 'Category lookup scope: navigation tree or the categories of a product.',
                },
                id: {
                    type: 'string',
                    maxLength: MAX_PRODUCT_ID_LENGTH,
                    description: 'Product or selected variant id. Implies product scope.',
                },
                sku: {
                    type: 'string',
                    maxLength: MAX_SKU_LENGTH,
                    description: 'Product SKU. Implies product scope.',
                },
                url: {
                    type: 'string',
                    maxLength: MAX_URL_LENGTH,
                    description: 'Same-origin product page URL. Implies product scope.',
                },
            },
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function normalizeInput(input: unknown, baseUrl: string): CategoryInput {
    if (!isPlainObject(input)) {
        throw new Error('Get product categories input must be an object.');
    }

    const rawScope = cleanText(input.scope);
    const id = normalizeOptionalStringField(input.id, MAX_PRODUCT_ID_LENGTH, 'Product id');
    const sku = normalizeOptionalStringField(input.sku, MAX_SKU_LENGTH, 'Product SKU');
    const url = normalizeUrlField(input.url, baseUrl);
    const hasProductLookup = Boolean(id || sku || url);
    const scope = (rawScope || (hasProductLookup ? 'product' : 'tree')) as CategoryScope;

    if (!VALID_SCOPES.includes(scope)) {
        throw new Error(`Category scope must be one of: ${VALID_SCOPES.join(', ')}.`);
    }

    if (scope === 'tree' && hasProductLookup) {
        throw new Error('A product id, SKU, or URL is only supported with product category scope.');
    }

    // Product scope without an explicit identifier falls back to the product page
    // the shopper is currently viewing (resolved server-side, see the runtime config).

    return {
        scope,
        ...(id ? { id } : {}),
        ...(sku ? { sku } : {}),
        ...(url ? { url } : {}),
    };
}

function normalizeUrlField(value: unknown, baseUrl: string): string | undefined {
    const rawUrl = normalizeOptionalStringField(value, MAX_URL_LENGTH, 'Product URL');

    if (!rawUrl) {
        return undefined;
    }

    const url = normalizeSameOriginUrl(rawUrl, baseUrl);

    if (!url) {
        throw new Error('Product URL must be a same-origin storefront URL or path.');
    }

    return url;
}

function buildCategoryResult(scope: CategoryScope, sourceUrl: string, tree: UnknownRecord[]): UnknownRecord {
    const flat = flattenCategories(tree);

    return {
        scope,
        source: 'store-api',
        sourceUrl,
        count: flat.length,
        activeCategoryIds: flat.filter((category) => category.active).map((category) => category.id),
        categories: flat,
        tree,
    };
}

function flattenCategories(tree: UnknownRecord[]): UnknownRecord[] {
    const flat: UnknownRecord[] = [];

    const walk = (nodes: UnknownRecord[]): void => {
        nodes.forEach((node) => {
            const { children, ...category } = node;
            flat.push(category);

            if (Array.isArray(children) && children.length > 0) {
                walk(children as UnknownRecord[]);
            }
        });
    };

    walk(tree);

    return flat;
}

function formatCategoryResult(result: UnknownRecord): string {
    const count = typeof result.count === 'number' ? result.count : 0;

    if (count === 0) {
        return result.scope === 'product'
            ? 'No categories are assigned to this product.'
            : 'No storefront navigation categories were returned.';
    }

    const label = result.scope === 'product' ? 'product' : 'navigation';

    return `Returned ${count} ${label} categor${count === 1 ? 'y' : 'ies'} from the Shopware Store API.`;
}
