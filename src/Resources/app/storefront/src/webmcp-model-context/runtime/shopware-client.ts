import { cleanText, isPlainObject, normalizeBaseUrl } from './tools/storefront-tool.utils';
import type {
    CartQuantityInput,
    CartSummary,
    ProductLookupInput,
    ProductSummary,
    QuantityInput,
    StorefrontToolOptions,
    UnknownRecord,
} from './types';
import { readAccessKey, readContextToken } from './transport/token-discovery';
import { StoreApiClient } from './transport/store-api';
import { StorefrontCartClient } from './transport/storefront-cart';
import { webMcpRequest } from './transport/webmcp';
import {
    createProductCriteria,
    normalizeProduct,
    normalizeProductCollection,
    toListingItem,
    productIdFromUrl,
} from './domain/product';
import { markActiveCategoryTrail, normalizeCategories, normalizeCategoryNode } from './domain/category';
import { normalizeCart } from './domain/cart';
import {
    buildListingUrl,
    createListingRequest,
    matchFilterNames,
    normalizeListingFacets,
    type ListingFacets,
    type ListingFilterInput,
    type ListingScope,
} from './domain/listing';
import {
    extractConfiguratorGroups,
    extractCurrentOptionMap,
    matchVariantSelections,
    type MatchedVariantSelection,
    type VariantSelection,
} from './domain/variant';
import { openCartOverlay, refreshCartUi } from './cart-ui-sync';

const WEBMCP_SALES_CHANNEL_CONTEXT_PATH = '/webmcp/sales-channel-context';

interface ResolvedListingRoute {
    path: string;
    query: string | null;
    scope: ListingScope;
    /** Whether this listing renders a product grid in the storefront (false for the CMS home root). */
    showable: boolean;
}

type FilterProductsInput = ListingFilterInput & {
    categoryId?: string | null | undefined;
    /** Manufacturer names, resolved to ids against the listing's facets. */
    manufacturers?: string[] | undefined;
    /** Property/variant option names (e.g. "red", "XL"), resolved to ids against the listing's facets. */
    propertyOptions?: string[] | undefined;
};

/**
 * Orchestrates the tools over the transports: product/category reads go through the Store
 * API (`StoreApiClient`, public access key, anonymous context); the cart goes through
 * Shopware's session-based storefront routes (`StorefrontCartClient`, session cookie, no
 * token); only the curated, PII-safe sales-channel context uses the plugin's own `/webmcp`
 * endpoint (`webMcpRequest`). Holds no transport details — just page-derived options and
 * domain-normalization wiring. See ADR 0004.
 */
export class ShopwareClient {
    private baseUrl: string;
    private storeApi: StoreApiClient;
    private storefrontCart: StorefrontCartClient;
    private navigationCategoryId: string | null;
    private currencyIsoCode: string | null;
    private activeCategoryId: string | null;
    private activeSearchTerm: string | null;
    private currentProductId: string | null;

    constructor(options: StorefrontToolOptions = {}) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.storeApi = new StoreApiClient(
            this.baseUrl,
            cleanText(options.accessKey) || readAccessKey(),
            cleanText(options.contextToken) || readContextToken(),
        );
        this.storefrontCart = new StorefrontCartClient(this.baseUrl);
        this.navigationCategoryId = cleanText(options.navigationCategoryId);
        this.currencyIsoCode = cleanText(options.currencyIsoCode);
        this.activeCategoryId = cleanText(options.activeCategoryId);
        this.activeSearchTerm = cleanText(options.activeSearchTerm);
        this.currentProductId = cleanText(options.currentProductId);
    }

    async searchProducts({ query, limit }: { query?: string | null; limit: number }): Promise<{
        products: ProductSummary[];
        total: number;
        listingUrl: string | null;
    }> {
        const searchTerm = cleanText(query);
        const result = (await this.storeApi.request(
            '/search',
            createProductCriteria({
                search: searchTerm,
                limit,
            }),
        )) as UnknownRecord;
        const products = normalizeProductCollection(result, this.baseUrl).map(toListingItem);

        return {
            products,
            total: Number.isInteger(result?.total) ? result.total : products.length,
            // The storefront search page renders the results — with a term it's that search, without
            // one it lists the whole catalog. Either way it is a real, navigable page.
            listingUrl: buildListingUrl(
                this.baseUrl,
                searchTerm ? { type: 'search', query: searchTerm } : { type: 'search' },
                {},
            ),
        };
    }

    /**
     * Returns the filter vocabulary (manufacturers, property groups, price range, sortings)
     * a category listing or search advertises, so an agent can map "red" / "XL" to concrete
     * filter ids before applying them.
     */
    async getListingFilters(
        scopeInput: { categoryId?: string | null | undefined; query?: string | null | undefined } = {},
    ): Promise<{ facets: ListingFacets; scope: ListingScope }> {
        const { path, query, scope } = this.resolveListingRoute(scopeInput);
        const result = await this.storeApi.request(path, createListingRequest({ query, limit: 1 }));

        return { facets: normalizeListingFacets(result), scope };
    }

    /**
     * Applies filters to a category listing or search and returns the matching products plus
     * the still-available facets (so the agent can refine further). Anonymous Store API read,
     * consistent with the other product reads (ADR 0001).
     */
    async filterProducts(input: FilterProductsInput = {}): Promise<{
        products: ProductSummary[];
        total: number;
        facets: ListingFacets;
        scope: ListingScope;
        listingUrl: string | null;
    }> {
        const { path, query, scope, showable } = this.resolveListingRoute(input);
        const resolvedInput = await this.resolveFilterNames(path, query, input);
        const result = (await this.storeApi.request(
            path,
            createListingRequest({ ...resolvedInput, query }),
        )) as UnknownRecord;
        const products = normalizeProductCollection(result, this.baseUrl).map(toListingItem);
        const facets = normalizeListingFacets(result);

        return {
            products,
            total: Number.isInteger(result?.total) ? result.total : products.length,
            facets,
            scope,
            // Only offer a URL for listings that actually render a product grid for the shopper.
            listingUrl: showable ? buildListingUrl(this.baseUrl, scope, { ...input, query }) : null,
        };
    }

    /**
     * Selects a variant on the active product detail page from option names or ids, optionally
     * adding the resolved variant to the cart. The current product is implicit (page-scoped),
     * so no product selector is needed. The exact variant is resolved deterministically over the
     * Store API (parent + option ids); the cart add rides the session, so the shopper operates
     * their own cart.
     */
    async selectVariant(
        input: ProductLookupInput & {
            selections?: VariantSelection[] | undefined;
            optionIds?: string[] | undefined;
            quantity: number;
            addToCart: boolean;
            showCartOverlay?: boolean | undefined;
        },
    ): Promise<{ variant: ProductSummary; selectedOptions: MatchedVariantSelection[]; cart: CartSummary | null }> {
        // Identify the product by an explicit selector when given, otherwise the current PDP product.
        const hasSelector = Boolean(cleanText(input.id) || cleanText(input.sku) || cleanText(input.url));
        const productId = hasSelector ? await this.resolveProductId(input) : cleanText(this.currentProductId);

        if (!productId) {
            throw new Error('Provide a product (id, sku, or url), or open a product detail page.');
        }

        const { groups, parentId, currentOptions } = await this.getVariantContext(productId);
        const { optionsMap, matched } = matchVariantSelections(groups, input.selections ?? [], input.optionIds ?? []);

        let resolvedProductId = productId;

        if (Object.keys(optionsMap).length > 0) {
            // Merge the requested options onto the variant currently shown, so a partial pick
            // ("just XL") keeps the other options, then resolve the exact variant deterministically
            // over the Store API (parentId + all option ids) rather than the incremental switch route.
            const targetOptions = { ...currentOptions, ...optionsMap };
            const variantId = await this.resolveVariantByOptions(parentId, Object.values(targetOptions));

            if (!variantId) {
                throw new Error('No product variant matches the selected options.');
            }

            resolvedProductId = variantId;
        }

        const variant = await this.getProduct({ id: resolvedProductId });
        let cart: CartSummary | null = null;

        if (input.addToCart) {
            await this.storefrontCart.addProduct(resolvedProductId, input.quantity);
            cart = this.finalizeCartMutation(await this.storefrontCart.loadCart(), input.showCartOverlay);
        }

        return { variant, selectedOptions: matched, cart };
    }

    /**
     * Loads what variant resolution needs from the product-detail response: the configurator
     * (all groups/options), the parent id that ties the variants together, and the options the
     * current variant already has selected.
     */
    private async getVariantContext(productId: string): Promise<{
        groups: ReturnType<typeof extractConfiguratorGroups>;
        parentId: string;
        currentOptions: Record<string, string>;
    }> {
        const result = (await this.storeApi.request(
            `/product/${encodeURIComponent(productId)}`,
            createProductCriteria({ limit: 1 }),
        )) as UnknownRecord;
        const product = isPlainObject(result?.product) ? result.product : result;
        const configurator = result?.configurator ?? (isPlainObject(product) ? product.configurator : null);

        return {
            groups: extractConfiguratorGroups(configurator),
            parentId: cleanText(isPlainObject(product) ? product.parentId : null) || productId,
            currentOptions: extractCurrentOptionMap(isPlainObject(product) ? product.options : null),
        };
    }

    /**
     * Finds the concrete variant that has exactly the given option ids, scoped to the parent's
     * variant set. Each option id is an ANDed `optionIds` filter, so only the matching combination
     * survives.
     */
    private async resolveVariantByOptions(parentId: string, optionIds: string[]): Promise<string | null> {
        const filter: UnknownRecord[] = [{ type: 'equals', field: 'parentId', value: parentId }];

        optionIds.forEach((optionId) => {
            filter.push({ type: 'equals', field: 'optionIds', value: optionId });
        });

        const result = await this.storeApi.request('/product', createProductCriteria({ filter, limit: 1 }));
        const products = normalizeProductCollection(result, this.baseUrl);

        return products[0]?.id ?? null;
    }

    /**
     * Resolves which Store API route serves the requested scope, and reports the scope actually
     * used so the agent can confirm it. Precedence: an explicitly chosen category, then an explicit
     * search term, then the page the shopper is on (active category, then active search term), then
     * the whole catalog. The whole catalog — and the CMS home root, which has no product grid — map
     * to the storefront search page with no term, which lists (and filters) the entire catalog and
     * IS renderable. So "filter this listing" / "show all red products" works from a category page,
     * a search page, or anywhere else in the shop.
     */
    private resolveListingRoute(scope: {
        categoryId?: string | null | undefined;
        query?: string | null | undefined;
    }): ResolvedListingRoute {
        const explicitCategoryId = cleanText(scope.categoryId);
        const query = cleanText(scope.query);

        if (explicitCategoryId) {
            return this.categoryRoute(explicitCategoryId);
        }

        if (query) {
            return this.searchRoute(query);
        }

        const activeCategoryId = cleanText(this.activeCategoryId);

        if (activeCategoryId) {
            return this.categoryRoute(activeCategoryId);
        }

        const activeSearchTerm = cleanText(this.activeSearchTerm);

        if (activeSearchTerm) {
            return this.searchRoute(activeSearchTerm);
        }

        // Whole-catalog fallback → the search page with no term (renderable "all products").
        return this.searchRoute(null);
    }

    private searchRoute(query: string | null): ResolvedListingRoute {
        return {
            path: '/search',
            query,
            scope: query ? { type: 'search', query } : { type: 'search' },
            showable: true,
        };
    }

    /**
     * Turns name-based filters (`manufacturers`, `propertyOptions`) into ids by reading the
     * listing's facets once, then merges them with any explicit `*Ids`. This collapses the
     * get_listing_filters → filter_products two-call flow into one. No names → no extra request.
     */
    private async resolveFilterNames(
        path: string,
        query: string | null,
        input: FilterProductsInput,
    ): Promise<FilterProductsInput> {
        if (!input.manufacturers?.length && !input.propertyOptions?.length) {
            return input;
        }

        const facetsResult = await this.storeApi.request(path, createListingRequest({ query, limit: 1 }));
        const facets = normalizeListingFacets(facetsResult);
        const resolved = matchFilterNames(facets, {
            manufacturers: input.manufacturers,
            propertyOptions: input.propertyOptions,
        });

        if (resolved.unmatched.length > 0) {
            const manufacturers = facets.manufacturers.map((entry) => entry.name).join(', ') || 'none';
            const options =
                facets.properties
                    .map((group) => `${group.group}: ${group.options.map((o) => o.name).join('/')}`)
                    .join('; ') || 'none';

            throw new Error(
                `No filter matches "${resolved.unmatched.join('", "')}". Available manufacturers: ${manufacturers}. Options — ${options}.`,
            );
        }

        return {
            ...input,
            manufacturerIds: [...(input.manufacturerIds ?? []), ...resolved.manufacturerIds],
            propertyOptionIds: [...(input.propertyOptionIds ?? []), ...resolved.propertyOptionIds],
        };
    }

    private categoryRoute(categoryId: string): ResolvedListingRoute {
        // The sales-channel root (home) category renders a CMS page, not a product grid; its
        // renderable equivalent is the search page with no term (the whole catalog).
        if (categoryId === cleanText(this.navigationCategoryId)) {
            return this.searchRoute(null);
        }

        return {
            path: `/product-listing/${encodeURIComponent(categoryId)}`,
            query: null,
            scope: { type: 'category', categoryId },
            showable: true,
        };
    }

    private async findProductBySku(sku: string): Promise<ProductSummary | null> {
        const result = await this.storeApi.request(
            '/search',
            createProductCriteria({
                limit: 1,
                filter: [
                    {
                        type: 'equals',
                        field: 'productNumber',
                        value: sku,
                    },
                ],
            }),
        );
        const products = normalizeProductCollection(result, this.baseUrl);

        if (products.length > 0) {
            return products[0] ?? null;
        }

        const fallbackResult = await this.searchProducts({ query: sku, limit: 1 });

        return fallbackResult.products[0] || null;
    }

    async getProduct(input: ProductLookupInput = {}): Promise<ProductSummary> {
        const productId = await this.resolveProductId(input);
        const result = (await this.storeApi.request(
            `/product/${encodeURIComponent(productId)}`,
            createProductCriteria({
                limit: 1,
            }),
        )) as UnknownRecord;
        const product = normalizeProduct(result?.product || result, this.baseUrl);

        if (!product) {
            throw new Error('No product details were returned by the Shopware Store API.');
        }

        return product;
    }

    async getNavigationCategories(depth = 2): Promise<UnknownRecord[]> {
        const rootId = cleanText(this.navigationCategoryId);

        if (!rootId) {
            throw new Error(
                'Category tree lookup requires a sales channel navigation category id. The storefront did not expose one.',
            );
        }

        const result = (await this.storeApi.request(
            `/navigation/${encodeURIComponent(rootId)}/${encodeURIComponent(rootId)}`,
            { depth, buildTree: true, associations: { seoUrls: {} } },
        )) as UnknownRecord;
        const elements = Array.isArray(result)
            ? result
            : Array.isArray(result?.elements)
              ? result.elements
              : isPlainObject(result?.elements)
                ? Object.values(result.elements)
                : [];
        const tree = elements
            .map((category: unknown) => normalizeCategoryNode(category, this.baseUrl, null))
            .filter((category: UnknownRecord | null): category is UnknownRecord => category !== null);

        markActiveCategoryTrail(tree, this.activeCategoryId);

        return tree;
    }

    async getProductCategories(input: ProductLookupInput = {}): Promise<UnknownRecord[]> {
        const hasLookup = Boolean(cleanText(input.id) || cleanText(input.sku) || cleanText(input.url));
        const productId = hasLookup ? await this.resolveProductId(input) : cleanText(this.currentProductId);

        if (!productId) {
            throw new Error('Product category scope requires a product id, SKU, or URL, or an active product page.');
        }

        const result = (await this.storeApi.request(
            `/product/${encodeURIComponent(productId)}`,
            createProductCriteria({
                limit: 1,
            }),
        )) as UnknownRecord;
        const product = result?.product || result;

        return normalizeCategories(product?.categories, this.baseUrl).map((category) => ({
            ...category,
            url: category.url || `${this.baseUrl}/navigation/${category.id}`,
            active: true,
            children: [],
        }));
    }

    async getCart({ showCartOverlay = false }: { showCartOverlay?: boolean } = {}): Promise<CartSummary> {
        const rawCart = await this.storefrontCart.loadCart();

        if (!isPlainObject(rawCart)) {
            throw new Error('No cart details were returned by the Shopware storefront cart endpoint.');
        }

        const cartOverlayOpened = showCartOverlay ? openCartOverlay(this.baseUrl) : false;

        return { ...normalizeCart(rawCart, this.baseUrl, this.currencyIsoCode), cartOverlayOpened };
    }

    async getSalesChannelContext(): Promise<UnknownRecord> {
        const payload = await webMcpRequest(this.webMcpUrl(WEBMCP_SALES_CHANNEL_CONTEXT_PATH));

        if (!isPlainObject(payload)) {
            throw new Error('No sales channel context was returned by the Shopware WebMCP endpoint.');
        }

        return payload;
    }

    async addProductToCart(input: QuantityInput): Promise<CartSummary | null> {
        const productId = await this.resolveProductId(input);
        // Relative add over the storefront route; Shopware sums quantity for an existing line.
        await this.storefrontCart.addProduct(productId, input.quantity);

        return this.finalizeCartMutation(await this.storefrontCart.loadCart(), input.showCartOverlay);
    }

    async updateLineItem(input: CartQuantityInput): Promise<CartSummary | null> {
        const productId = await this.resolveProductId(input);
        // Read the cart once to branch present/absent; the line-item id equals the product id.
        const currentCart = await this.storefrontCart.loadCart();
        const present = this.rawCartHasLineItem(currentCart, productId);

        if (input.quantity <= 0) {
            // Target 0 = remove; a no-op (return the current cart) when it is not present.
            if (!present) {
                return this.finalizeCartMutation(currentCart, input.showCartOverlay);
            }
            await this.storefrontCart.removeLineItem(productId);
        } else if (present) {
            await this.storefrontCart.changeQuantity(productId, input.quantity);
        } else {
            await this.storefrontCart.addProduct(productId, input.quantity);
        }

        return this.finalizeCartMutation(await this.storefrontCart.loadCart(), input.showCartOverlay);
    }

    async clearCart({ showCartOverlay = false }: { showCartOverlay?: boolean } = {}): Promise<CartSummary | null> {
        // Read the cart, then bulk-remove all line items by id (portable across the
        // supported Shopware range; /checkout/cart/delete only exists in later 6.7).
        const currentCart = await this.storefrontCart.loadCart();
        const ids = this.rawCartLineItemIds(currentCart);

        if (ids.length === 0) {
            return this.finalizeCartMutation(currentCart, showCartOverlay);
        }

        await this.storefrontCart.removeLineItems(ids);

        return this.finalizeCartMutation(await this.storefrontCart.loadCart(), showCartOverlay);
    }

    private rawCartLineItemIds(rawCart: unknown): string[] {
        if (!isPlainObject(rawCart)) {
            return [];
        }

        const cart = normalizeCart(rawCart, this.baseUrl, this.currencyIsoCode);

        return Array.isArray(cart.lineItems)
            ? cart.lineItems
                  .map((lineItem) => lineItem.id)
                  .filter((id): id is string => typeof id === 'string' && id.length > 0)
            : [];
    }

    private rawCartHasLineItem(rawCart: unknown, productId: string): boolean {
        if (!isPlainObject(rawCart)) {
            return false;
        }

        const cart = normalizeCart(rawCart, this.baseUrl, this.currencyIsoCode);

        return Array.isArray(cart.lineItems) && cart.lineItems.some((lineItem) => lineItem.id === productId);
    }

    private async resolveProductId(input: ProductLookupInput): Promise<string> {
        const id = cleanText(input.id);
        const sku = cleanText(input.sku);
        const productUrl = cleanText(input.url);

        if (id) {
            return id;
        }

        if (sku) {
            const product = await this.findProductBySku(sku);

            if (!product?.id) {
                throw new Error(`No product found for SKU ${input.sku}.`);
            }

            return product.id;
        }

        if (productUrl) {
            const productId = productIdFromUrl(productUrl, this.baseUrl);

            if (productId) {
                return productId;
            }
        }

        throw new Error('Product lookup requires a Shopware product id, SKU/product number, or /detail/{id} URL.');
    }

    private webMcpUrl(path: string): string {
        return new URL(path, this.baseUrl).toString();
    }

    /**
     * The server returns the authoritative (raw Store API) cart, so there is no client-side
     * delta to compute — normalize it into the compact cart shape and refresh the storefront
     * cart UI so the shopper sees the change. When `showCartOverlay` is set, also open the
     * off-canvas cart so the change is unmistakable.
     */
    private finalizeCartMutation(rawCart: unknown, showCartOverlay = false): CartSummary | null {
        if (!isPlainObject(rawCart)) {
            return null;
        }

        const cartOverlayOpened = showCartOverlay ? openCartOverlay(this.baseUrl) : false;
        const cart = normalizeCart(rawCart, this.baseUrl, this.currencyIsoCode);
        const cartWidgetRefreshed = refreshCartUi(this.baseUrl);

        return { ...cart, cartWidgetRefreshed, cartOverlayOpened };
    }
}
