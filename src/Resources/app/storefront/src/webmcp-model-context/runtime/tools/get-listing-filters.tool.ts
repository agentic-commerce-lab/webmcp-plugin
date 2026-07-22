import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { boundedString, MAX_PRODUCT_ID_LENGTH } from './schemas';
import type { ListingFacets } from '../domain/listing';
import type { StorefrontToolOptions } from '../types';

export const GET_LISTING_FILTERS_TOOL_NAME = 'shopware_webmcp_get_listing_filters';

const MAX_LISTING_QUERY_LENGTH = 120;

const getListingFiltersInput = z.object({
    categoryId: boundedString(MAX_PRODUCT_ID_LENGTH, 'Category id')
        .describe('Category to inspect. Omit to use the listing the shopper is currently viewing.')
        .optional(),
    query: boundedString(MAX_LISTING_QUERY_LENGTH, 'Search query')
        .describe('Search term whose result set to inspect. Use instead of categoryId for a search listing.')
        .optional(),
});

export function createGetListingFiltersTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: GET_LISTING_FILTERS_TOOL_NAME,
        title: 'Get listing filters',
        description:
            'Returns the filter vocabulary for a category or search listing: manufacturers, property groups with their options (e.g. Color → red), price range, rating, and available sort orders — each with the ids needed by filter_products. Call this first to map words like "red" or "XL" to concrete option ids. With no categoryId or query it uses the listing the shopper is currently viewing (the active category, or the current search results); the returned `scope` says which listing was used.',
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        input: getListingFiltersInput,
        execute: async (input) => {
            const { facets, scope } = await shopwareClient.getListingFilters(input);

            return {
                content: [{ type: 'text', text: formatFacets(facets) }],
                structuredContent: { scope, filters: facets },
            };
        },
    });
}

function formatFacets(facets: ListingFacets): string {
    const lines: string[] = [`${facets.total} product${facets.total === 1 ? '' : 's'} in scope.`];

    if (facets.manufacturers.length > 0) {
        lines.push(`Manufacturers: ${facets.manufacturers.map((manufacturer) => manufacturer.name).join(', ')}.`);
    }

    facets.properties.forEach((group) => {
        lines.push(`${group.group || 'Options'}: ${group.options.map((option) => option.name).join(', ')}.`);
    });

    if (facets.price) {
        lines.push(`Price range: ${facets.price.min ?? '?'}–${facets.price.max ?? '?'}.`);
    }

    if (facets.sortings.length > 0) {
        lines.push(`Sort options: ${facets.sortings.map((sorting) => sorting.key).join(', ')}.`);
    }

    return lines.join('\n');
}
