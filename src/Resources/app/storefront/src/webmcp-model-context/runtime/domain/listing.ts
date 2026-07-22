import { cleanText, isPlainObject, removeEmptyValues } from '../tools/storefront-tool.utils';
import type { UnknownRecord } from '../types';

/** A selectable filter value (manufacturer or property option). */
export interface ListingFacetOption {
    id: string;
    name: string;
}

/** A property facet grouped by its property group (e.g. "Color" → red, blue). */
export interface ListingPropertyGroup {
    groupId: string | null;
    group: string | null;
    options: ListingFacetOption[];
}

/** One selectable sort order the listing offers. */
export interface ListingSorting {
    key: string;
    label: string | null;
    active: boolean;
}

/** The filter vocabulary + pagination a listing/search response advertises. */
export interface ListingFacets {
    total: number;
    page: number;
    limit: number | null;
    sortings: ListingSorting[];
    activeSorting: string | null;
    manufacturers: ListingFacetOption[];
    properties: ListingPropertyGroup[];
    price: { min: number | null; max: number | null } | null;
    ratingMax: number | null;
    shippingFreeAvailable: boolean;
}

/** The listing the tool actually resolved to, echoed back so the agent can confirm the scope. */
export interface ListingScope {
    type: 'category' | 'search';
    categoryId?: string;
    query?: string;
}

/** Filter inputs a caller may apply to a listing/search request. */
export interface ListingFilterInput {
    query?: string | null | undefined;
    manufacturerIds?: string[] | undefined;
    propertyOptionIds?: string[] | undefined;
    priceMin?: number | null | undefined;
    priceMax?: number | null | undefined;
    minRating?: number | null | undefined;
    shippingFree?: boolean | undefined;
    sort?: string | null | undefined;
    limit?: number | null | undefined;
    page?: number | null | undefined;
}

const CRITERIA_PARAM = 'p';

/**
 * Builds the flat request body Shopware's product-listing / search routes read. Multi-value
 * filters are pipe-separated exactly like the storefront's own filter query string, so the
 * Store API resolves them through the same `ProductListingFeaturesSubscriber` logic.
 */
export function createListingRequest(input: ListingFilterInput): UnknownRecord {
    const manufacturer = joinIds(input.manufacturerIds);
    const properties = joinIds(input.propertyOptionIds);
    const minPrice = positiveNumber(input.priceMin);
    const maxPrice = positiveNumber(input.priceMax);
    const rating = positiveNumber(input.minRating);
    const shippingFree = input.shippingFree ? true : null;
    // Shopware applies listing filters as post-filters and, by default, computes aggregations over
    // the UNFILTERED result — so the facets would still advertise options with zero matches under
    // the current filters. `reduce-aggregations` narrows them to genuine refinements once a filter
    // is active.
    const hasFilters = Boolean(
        manufacturer || properties || minPrice !== null || maxPrice !== null || rating !== null || shippingFree,
    );

    return removeEmptyValues({
        search: cleanText(input.query),
        manufacturer,
        properties,
        'min-price': minPrice,
        'max-price': maxPrice,
        rating,
        'shipping-free': shippingFree,
        order: cleanText(input.sort),
        limit: positiveInteger(input.limit),
        [CRITERIA_PARAM]: positiveInteger(input.page),
        'reduce-aggregations': hasFilters ? true : null,
    });
}

/**
 * Builds the storefront listing URL that renders these filters for a human — the same URL a
 * shopper would land on by clicking the filter panel. Category scope uses `/navigation/{id}`
 * (Shopware redirects to the SEO listing); search scope uses `/search?search=…`. The filter
 * query params reuse the storefront's own names (pipe-separated multi-values), so the rendered
 * page matches what `filter_products` computed.
 */
export function buildListingUrl(baseUrl: string, scope: ListingScope, input: ListingFilterInput): string {
    const path = scope.type === 'search' ? '/search' : `/navigation/${encodeURIComponent(scope.categoryId ?? '')}`;
    const url = new URL(path, `${baseUrl}/`);
    const params = url.searchParams;

    if (scope.type === 'search' && scope.query) {
        params.set('search', scope.query);
    }

    setParam(params, 'manufacturer', joinIds(input.manufacturerIds));
    setParam(params, 'properties', joinIds(input.propertyOptionIds));
    setParam(params, 'min-price', numberParam(input.priceMin));
    setParam(params, 'max-price', numberParam(input.priceMax));
    setParam(params, 'rating', numberParam(input.minRating));
    setParam(params, 'shipping-free', input.shippingFree ? '1' : null);
    setParam(params, 'order', cleanText(input.sort));
    setParam(params, 'p', integerParam(input.page));

    return url.toString();
}

function setParam(params: URLSearchParams, key: string, value: string | null): void {
    if (value !== null) {
        params.set(key, value);
    }
}

function numberParam(value: unknown): string | null {
    const parsed = positiveNumber(value);

    return parsed === null ? null : String(parsed);
}

function integerParam(value: unknown): string | null {
    const parsed = positiveInteger(value);

    return parsed === null ? null : String(parsed);
}

export interface ResolvedFilterNames {
    manufacturerIds: string[];
    propertyOptionIds: string[];
    unmatched: string[];
}

/**
 * Resolves manufacturer/property-option NAMES against a listing's facets into their ids, so
 * `filter_products` can take "red"/"Shopware Fashion" directly and skip the extra
 * get_listing_filters round-trip. Names are matched case-insensitively; anything unmatched is
 * reported so the caller can surface the available options.
 */
export function matchFilterNames(
    facets: ListingFacets,
    names: { manufacturers?: string[] | undefined; propertyOptions?: string[] | undefined },
): ResolvedFilterNames {
    const unmatched: string[] = [];
    const options = facets.properties.flatMap((group) => group.options);

    const resolve = (requested: string[] | undefined, pool: ListingFacetOption[]): string[] =>
        (requested ?? []).flatMap((name) => {
            const term = cleanText(name);
            const hit = term ? pool.find((option) => option.name.toLowerCase() === term.toLowerCase()) : null;

            if (!hit) {
                if (term) {
                    unmatched.push(term);
                }

                return [];
            }

            return [hit.id];
        });

    return {
        manufacturerIds: resolve(names.manufacturers, facets.manufacturers),
        propertyOptionIds: resolve(names.propertyOptions, options),
        unmatched,
    };
}

export function normalizeListingFacets(result: unknown): ListingFacets {
    const listing = isPlainObject(result) ? result : {};
    const aggregations = isPlainObject(listing.aggregations) ? listing.aggregations : {};

    return {
        total: Number.isFinite(listing.total) ? Number(listing.total) : 0,
        page: Number.isFinite(listing.page) ? Number(listing.page) : 1,
        limit: Number.isFinite(listing.limit) ? Number(listing.limit) : null,
        sortings: normalizeSortings(listing.availableSortings, cleanText(listing.sorting)),
        activeSorting: cleanText(listing.sorting),
        manufacturers: normalizeFacetOptions(aggregations.manufacturer),
        properties: normalizeProperties(aggregations.properties),
        price: normalizePriceRange(aggregations.price),
        ratingMax: normalizeRatingMax(aggregations.rating),
        shippingFreeAvailable: hasShippingFree(aggregations['shipping-free']),
    };
}

/**
 * Shopware always serializes the `shipping-free` max aggregation when the feature is enabled, with
 * `max` = "1" only when the listing actually contains a free-shipping product (0/null otherwise).
 * So inspect the value, not the mere presence of the aggregation.
 */
function hasShippingFree(aggregation: unknown): boolean {
    if (!isPlainObject(aggregation)) {
        return false;
    }

    return (toFiniteNumber(aggregation.max) ?? 0) > 0;
}

function normalizeSortings(value: unknown, active: string | null): ListingSorting[] {
    return toArray(value)
        .map((sorting): ListingSorting | null => {
            if (!isPlainObject(sorting)) {
                return null;
            }

            const key = cleanText(sorting.key);

            if (!key) {
                return null;
            }

            return {
                key,
                label: translatedName(sorting) || key,
                active: key === active,
            };
        })
        .filter((sorting): sorting is ListingSorting => sorting !== null);
}

function normalizeFacetOptions(aggregation: unknown): ListingFacetOption[] {
    const entities = isPlainObject(aggregation) ? aggregation.entities : aggregation;

    return toArray(entities)
        .map((entity) => normalizeFacetOption(entity))
        .filter((option): option is ListingFacetOption => option !== null);
}

function normalizeFacetOption(entity: unknown): ListingFacetOption | null {
    if (!isPlainObject(entity)) {
        return null;
    }

    const id = cleanText(entity.id);
    const name = translatedName(entity);

    if (!id || !name) {
        return null;
    }

    return { id, name };
}

/**
 * Property aggregations come back in two shapes across Shopware versions: either as
 * property-group entities that already carry their `options`, or as a flat list of
 * property-group-option entities that each reference their `group`. Both are folded into
 * the same grouped structure.
 */
function normalizeProperties(aggregation: unknown): ListingPropertyGroup[] {
    const entities = isPlainObject(aggregation) ? aggregation.entities : aggregation;
    const groups = new Map<string, ListingPropertyGroup>();

    toArray(entities).forEach((entity) => {
        if (!isPlainObject(entity)) {
            return;
        }

        const nestedOptions = toArray(entity.options);

        if (nestedOptions.length > 0) {
            const groupId = cleanText(entity.id);
            const group = upsertGroup(groups, groupId, translatedName(entity));
            nestedOptions.forEach((option) => appendOption(group, normalizeFacetOption(option)));

            return;
        }

        const option = normalizeFacetOption(entity);

        if (!option) {
            return;
        }

        const groupRef = isPlainObject(entity.group) ? entity.group : null;
        const groupId = cleanText(groupRef?.id) || cleanText(entity.groupId);
        const group = upsertGroup(groups, groupId, groupRef ? translatedName(groupRef) : null);
        appendOption(group, option);
    });

    return Array.from(groups.values()).filter((group) => group.options.length > 0);
}

function upsertGroup(
    groups: Map<string, ListingPropertyGroup>,
    groupId: string | null,
    group: string | null,
): ListingPropertyGroup {
    const key = groupId || group || `__ungrouped_${groups.size}`;
    const existing = groups.get(key);

    if (existing) {
        if (!existing.group && group) {
            existing.group = group;
        }

        return existing;
    }

    const created: ListingPropertyGroup = { groupId, group, options: [] };
    groups.set(key, created);

    return created;
}

function appendOption(group: ListingPropertyGroup, option: ListingFacetOption | null): void {
    if (!option || group.options.some((existing) => existing.id === option.id)) {
        return;
    }

    group.options.push(option);
}

function normalizePriceRange(aggregation: unknown): { min: number | null; max: number | null } | null {
    if (!isPlainObject(aggregation)) {
        return null;
    }

    const min = toFiniteNumber(aggregation.min);
    const max = toFiniteNumber(aggregation.max);

    if (min === null && max === null) {
        return null;
    }

    return { min, max };
}

function normalizeRatingMax(aggregation: unknown): number | null {
    if (!isPlainObject(aggregation)) {
        return null;
    }

    return toFiniteNumber(aggregation.max);
}

/** Store API stats aggregations return numeric bounds as strings (e.g. "19.9900"); coerce them. */
function toFiniteNumber(value: unknown): number | null {
    const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;

    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

function translatedName(entity: UnknownRecord): string | null {
    const translated = isPlainObject(entity.translated) ? entity.translated : {};

    return (
        cleanText(translated.name) || cleanText(entity.name) || cleanText(translated.label) || cleanText(entity.label)
    );
}

function toArray(value: unknown): any[] {
    if (Array.isArray(value)) {
        return value;
    }

    if (isPlainObject(value) && isPlainObject(value.elements)) {
        return Object.values(value.elements);
    }

    if (isPlainObject(value)) {
        return Object.values(value);
    }

    return [];
}

function joinIds(ids: unknown): string | null {
    if (!Array.isArray(ids)) {
        return null;
    }

    const cleaned = ids.map((id) => cleanText(id)).filter((id): id is string => Boolean(id));

    return cleaned.length > 0 ? cleaned.join('|') : null;
}

function positiveNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}
