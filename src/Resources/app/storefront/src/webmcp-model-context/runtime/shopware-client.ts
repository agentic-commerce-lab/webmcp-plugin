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

const WEBMCP_CART_PATH = '/webmcp/cart';
const WEBMCP_CART_LINE_ITEM_PATH = '/webmcp/cart/line-item';
const WEBMCP_SALES_CHANNEL_CONTEXT_PATH = '/webmcp/sales-channel-context';

/**
 * Orchestrates the storefront tools against the two transports: read/search go
 * through the Store API (`StoreApiClient`), cart writes and context reads through
 * the plugin's own same-origin `/webmcp` endpoints (`webMcpRequest`). This class
 * holds no transport details itself — only the page-derived options and the
 * domain normalization wiring.
 */
export class ShopwareClient {
    private baseUrl: string;
    private storeApi: StoreApiClient;
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
        const rawCart = await webMcpRequest(this.webMcpUrl(WEBMCP_CART_PATH));

        if (!isPlainObject(rawCart)) {
            throw new Error('No cart details were returned by the Shopware WebMCP cart endpoint.');
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
        const cart = await webMcpRequest(this.webMcpUrl(WEBMCP_CART_LINE_ITEM_PATH), {
            method: 'POST',
            body: { productId, quantity: input.quantity },
        });

        if (input.showCartOverlay) {
            openCartOverlay(this.baseUrl);
        }

        return this.finalizeCartMutation(cart);
    }

    async updateLineItem(input: CartQuantityInput): Promise<CartSummary | null> {
        const productId = await this.resolveProductId(input);
        const cart = await webMcpRequest(this.webMcpUrl(WEBMCP_CART_LINE_ITEM_PATH), {
            method: 'PATCH',
            body: { productId, quantity: input.quantity },
        });

        return this.finalizeCartMutation(cart);
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
