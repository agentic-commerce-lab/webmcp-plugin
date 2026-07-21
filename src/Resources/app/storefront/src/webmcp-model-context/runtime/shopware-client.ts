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
    productIdFromUrl,
} from './domain/product';
import { markActiveCategoryTrail, normalizeCategories, normalizeCategoryNode } from './domain/category';
import { normalizeCart } from './domain/cart';
import { openCartOverlay, refreshCartUi } from './cart-ui-sync';

const WEBMCP_SALES_CHANNEL_CONTEXT_PATH = '/webmcp/sales-channel-context';

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
        this.currentProductId = cleanText(options.currentProductId);
    }

    async searchProducts({ query, limit }: { query?: string | null; limit: number }): Promise<{
        products: ProductSummary[];
        total: number;
    }> {
        const result = (await this.storeApi.request(
            '/search',
            createProductCriteria({
                search: query,
                limit,
            }),
        )) as UnknownRecord;
        const products = normalizeProductCollection(result, this.baseUrl);

        return {
            products,
            total: Number.isInteger(result?.total) ? result.total : products.length,
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

    async getCart(): Promise<CartSummary> {
        const rawCart = await this.storefrontCart.loadCart();

        if (!isPlainObject(rawCart)) {
            throw new Error('No cart details were returned by the Shopware storefront cart endpoint.');
        }

        return normalizeCart(rawCart, this.baseUrl, this.currencyIsoCode);
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

        if (input.showCartOverlay) {
            openCartOverlay(this.baseUrl);
        }

        return this.finalizeCartMutation(await this.storefrontCart.loadCart());
    }

    async updateLineItem(input: CartQuantityInput): Promise<CartSummary | null> {
        const productId = await this.resolveProductId(input);
        // Read the cart once to branch present/absent; the line-item id equals the product id.
        const currentCart = await this.storefrontCart.loadCart();
        const present = this.rawCartHasLineItem(currentCart, productId);

        if (input.quantity <= 0) {
            // Target 0 = remove; a no-op (return the current cart) when it is not present.
            if (!present) {
                return this.finalizeCartMutation(currentCart);
            }
            await this.storefrontCart.removeLineItem(productId);
        } else if (present) {
            await this.storefrontCart.changeQuantity(productId, input.quantity);
        } else {
            await this.storefrontCart.addProduct(productId, input.quantity);
        }

        return this.finalizeCartMutation(await this.storefrontCart.loadCart());
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
     * cart UI so the shopper sees the change.
     */
    private finalizeCartMutation(rawCart: unknown): CartSummary | null {
        if (!isPlainObject(rawCart)) {
            return null;
        }

        const cart = normalizeCart(rawCart, this.baseUrl, this.currencyIsoCode);
        const cartWidgetRefreshed = refreshCartUi(this.baseUrl);

        return { ...cart, cartWidgetRefreshed };
    }
}
