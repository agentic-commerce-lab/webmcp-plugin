import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { productSelectorShape } from './schemas';
import type { StorefrontToolOptions, UnknownRecord } from '../types';

export const GET_PRODUCT_CATEGORIES_TOOL_NAME = 'shopware_webmcp_get_product_categories';

const VALID_SCOPES = ['tree', 'product'] as const;
const NAVIGATION_TREE_DEPTH = 2;

type CategoryScope = (typeof VALID_SCOPES)[number];

const getProductCategoriesInput = z
    .object({
        scope: z
            .enum(VALID_SCOPES)
            .describe('Category lookup scope: navigation tree or the categories of a product. Defaults to tree.')
            .optional(),
        ...productSelectorShape,
    })
    .superRefine((value, ctx) => {
        if (resolveScope(value) === 'tree' && hasProductSelector(value)) {
            ctx.addIssue({
                code: 'custom',
                message: 'A product id, SKU, or URL is only supported with product category scope.',
            });
        }
    });

type GetProductCategoriesInput = z.output<typeof getProductCategoriesInput>;

export function createGetProductCategoriesTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: GET_PRODUCT_CATEGORIES_TOOL_NAME,
        title: 'Get product categories',
        description:
            "Returns the navigation category tree (active trail marked) or a product's categories, from the Store API. For product scope pass id/sku/url, or omit to use the current product page.",
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        input: getProductCategoriesInput,
        execute: async (input) => {
            const scope = resolveScope(input);
            const tree =
                scope === 'product'
                    ? await shopwareClient.getProductCategories(input)
                    : await shopwareClient.getNavigationCategories(NAVIGATION_TREE_DEPTH);
            const result = buildCategoryResult(scope, tree);

            return {
                content: [{ type: 'text', text: formatCategoryResult(result) }],
                structuredContent: { lookup: lookupOf(scope, input), ...result },
            };
        },
    });
}

function hasProductSelector(value: GetProductCategoriesInput): boolean {
    return [value.id, value.sku, value.url].some((entry) => typeof entry === 'string' && entry.trim() !== '');
}

function resolveScope(value: GetProductCategoriesInput): CategoryScope {
    return value.scope ?? (hasProductSelector(value) ? 'product' : 'tree');
}

function lookupOf(scope: CategoryScope, input: GetProductCategoriesInput): UnknownRecord {
    return {
        scope,
        ...(input.id ? { id: input.id } : {}),
        ...(input.sku ? { sku: input.sku } : {}),
        ...(input.url ? { url: input.url } : {}),
    };
}

function buildCategoryResult(scope: CategoryScope, tree: UnknownRecord[]): UnknownRecord {
    // Flat list only: each category keeps its `parentId`, so the hierarchy is reconstructable
    // without duplicating the whole nested `tree` (same data twice).
    const flat = flattenCategories(tree);

    return {
        scope,
        source: 'store-api',
        count: flat.length,
        activeCategoryIds: flat.filter((category) => category.active).map((category) => category.id),
        categories: flat,
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
