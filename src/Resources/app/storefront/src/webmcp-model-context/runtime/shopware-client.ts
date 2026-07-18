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
import {
    ACCESS_KEY_HEADER,
    CONTEXT_TOKEN_HEADER,
    persistContextToken,
    readAccessKey,
    readContextToken,
} from './transport/token-discovery';
import { parseJsonResponse, storeApiErrorMessage, webMcpErrorMessage } from './transport/http';
import {
    createProductCriteria,
    normalizeProduct,
    normalizeProductCollection,
    productIdFromUrl,
} from './domain/product';
import { markActiveCategoryTrail, normalizeCategories, normalizeCategoryNode } from './domain/category';
import { openCartOverlay, refreshCartUi } from './cart-ui-sync';

const STORE_API_PATH = '/store-api';
const WEBMCP_CART_PATH = '/webmcp/cart';
const WEBMCP_CART_LINE_ITEM_PATH = '/webmcp/cart/line-item';
const WEBMCP_SALES_CHANNEL_CONTEXT_PATH = '/webmcp/sales-channel-context';

export class ShopwareClient {
    private baseUrl: string;
    private contextToken: string | null;
    private accessKey: string | null;
    private navigationCategoryId: string | null;
    private activeCategoryId: string | null;
    private currentProductId: string | null;

    constructor(options: StorefrontToolOptions = {}) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.contextToken = cleanText(options.contextToken) || readContextToken();
        this.accessKey = cleanText(options.accessKey) || readAccessKey();
        this.navigationCategoryId = cleanText(options.navigationCategoryId);
        this.activeCategoryId = cleanText(options.activeCategoryId);
        this.currentProductId = cleanText(options.currentProductId);
    }

    async searchProducts({ query, limit }: { query?: string | null; limit: number }): Promise<{
        products: ProductSummary[];
        total: number;
    }> {
        const result = (await this.storeApiRequest(
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

    async findProductBySku(sku: string): Promise<ProductSummary | null> {
        const result = await this.storeApiRequest(
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
        const result = (await this.storeApiRequest(
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

        const result = (await this.storeApiRequest(
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

        const result = (await this.storeApiRequest(
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
        const cart = await this.webMcpCartRequest();

        if (!isPlainObject(cart)) {
            throw new Error('No cart details were returned by the Shopware WebMCP cart endpoint.');
        }

        return cart;
    }

    async getSalesChannelContext(): Promise<UnknownRecord> {
        const url = new URL(WEBMCP_SALES_CHANNEL_CONTEXT_PATH, this.baseUrl);
        const response = await fetch(url.toString(), {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
        });
        const payload = await parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(webMcpErrorMessage(response, payload));
        }

        if (!isPlainObject(payload)) {
            throw new Error('No sales channel context was returned by the Shopware WebMCP endpoint.');
        }

        return payload;
    }

    async addProductToCart(input: QuantityInput): Promise<CartSummary | null> {
        const productId = await this.resolveProductId(input);
        const cart = await this.cartWriteRequest('POST', { productId, quantity: input.quantity });

        if (input.showCartOverlay) {
            openCartOverlay(this.baseUrl);
        }

        return this.finalizeCartMutation(cart);
    }

    async updateLineItem(input: CartQuantityInput): Promise<CartSummary | null> {
        const productId = await this.resolveProductId(input);
        const cart = await this.cartWriteRequest('PATCH', { productId, quantity: input.quantity });

        return this.finalizeCartMutation(cart);
    }

    async resolveProductId(input: ProductLookupInput): Promise<string> {
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

    async storeApiRequest(path: string, body: UnknownRecord = {}): Promise<unknown> {
        const url = new URL(`${STORE_API_PATH}${path}`, this.baseUrl);
        const headers: Record<string, string> = {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        };

        if (this.accessKey) {
            headers[ACCESS_KEY_HEADER] = this.accessKey;
        }

        if (this.contextToken) {
            headers[CONTEXT_TOKEN_HEADER] = this.contextToken;
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify(body),
        });
        const responseContextToken = cleanText(response.headers.get(CONTEXT_TOKEN_HEADER));

        if (responseContextToken) {
            this.contextToken = responseContextToken;
            persistContextToken(responseContextToken);
        }

        const payload = await parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(storeApiErrorMessage(response, payload));
        }

        return payload;
    }

    async webMcpCartRequest(): Promise<unknown> {
        const url = new URL(WEBMCP_CART_PATH, this.baseUrl);
        const response = await fetch(url.toString(), {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
        });
        const payload = await parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(webMcpErrorMessage(response, payload));
        }

        return payload;
    }

    async cartWriteRequest(method: 'POST' | 'PATCH', body: UnknownRecord): Promise<unknown> {
        const url = new URL(WEBMCP_CART_LINE_ITEM_PATH, this.baseUrl);
        const response = await fetch(url.toString(), {
            method,
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify(body),
        });
        const payload = await parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(webMcpErrorMessage(response, payload));
        }

        return payload;
    }

    /**
     * The server returns the authoritative cart, so there is no client-side delta to
     * compute — just refresh the storefront cart UI so the shopper sees the change.
     */
    private finalizeCartMutation(cart: unknown): CartSummary | null {
        if (!isPlainObject(cart)) {
            return null;
        }

        const cartWidgetRefreshed = refreshCartUi(this.baseUrl);

        return { ...cart, cartWidgetRefreshed } as CartSummary;
    }
}
