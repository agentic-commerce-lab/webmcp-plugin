import {
    cleanText,
    fetchStorefrontHtml,
    isPlainObject,
    normalizeBaseUrl,
    parseHtmlDocument,
} from './tools/storefront-tool.utils';
import type {
    CartQuantityInput,
    CartSummary,
    ProductLookupInput,
    ProductSummary,
    QuantityInput,
    StorefrontToolOptions,
    UnknownRecord,
} from './types';
import { STOREFRONT_CART_PATH } from './transport/paths';
import {
    ACCESS_KEY_HEADER,
    CONTEXT_TOKEN_HEADER,
    persistContextToken,
    readAccessKey,
    readContextToken,
    readCsrfToken,
} from './transport/token-discovery';
import {
    parseFlexibleResponse,
    parseJsonResponse,
    storeApiErrorMessage,
    storefrontErrorMessage,
    webMcpCartErrorMessage,
} from './transport/http';
import {
    createProductCriteria,
    normalizeProduct,
    normalizeProductCollection,
    productIdFromUrl,
} from './domain/product';
import { markActiveCategoryTrail, normalizeCategories, normalizeCategoryNode } from './domain/category';
import {
    createAddToCartFormBody,
    findCartLineItemInDocument,
    findCartLineItemInPayload,
    normalizeCart,
    normalizeLineItems,
} from './domain/cart';
import { publishCartMutation } from './cart-ui-sync';

const STORE_API_PATH = '/store-api';
const WEBMCP_CART_PATH = '/webmcp/cart';
const STOREFRONT_ADD_TO_CART_PATH = '/checkout/line-item/add';
const STOREFRONT_CHANGE_LINE_ITEM_QUANTITY_PATH = '/checkout/line-item/change-quantity';
const STOREFRONT_REMOVE_FROM_CART_PATH = '/checkout/line-item/delete';

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

    async addProductToCart(input: QuantityInput): Promise<CartSummary | null> {
        const productId = await this.resolveProductId(input);
        const cart = await this.storefrontAddProductToCart({
            productId,
            quantity: input.quantity,
            lineItemId: cleanText(input.lineItemId) || productId,
        });

        return normalizeCart(cart);
    }

    async removeProductFromCart(input: CartQuantityInput): Promise<CartSummary | null> {
        const lineItemId = cleanText(input.lineItemId) || (await this.resolveProductId(input));
        const cartLineItem = await this.findStorefrontCartLineItem(lineItemId);

        if (!cartLineItem) {
            throw new Error(`No cart line item found for ${lineItemId}.`);
        }

        const remainingQuantity = cartLineItem.quantity - input.quantity;
        const cart =
            remainingQuantity > 0
                ? await this.storefrontChangeLineItemQuantity({
                      lineItemId,
                      quantity: remainingQuantity,
                      previousQuantity: cartLineItem.quantity,
                      removedQuantity: input.quantity,
                  })
                : await this.storefrontRemoveLineItemFromCart({
                      lineItemId,
                      previousQuantity: cartLineItem.quantity,
                      removedQuantity: cartLineItem.quantity,
                  });

        return normalizeCart(cart);
    }

    async updateLineItem(input: CartQuantityInput): Promise<CartSummary | null> {
        const lineItemIdInput = cleanText(input.lineItemId);
        const lineItemLookup = lineItemIdInput || (await this.resolveProductId(input));
        const cartLineItem = await this.findStorefrontCartLineItem(lineItemLookup);

        if (!cartLineItem) {
            if (!lineItemIdInput && input.quantity > 0) {
                return this.addProductToCart(input);
            }

            throw new Error(`No cart line item found for ${lineItemLookup}.`);
        }

        const lineItemId = cartLineItem.id;
        const quantityDelta = input.quantity - cartLineItem.quantity;
        const cart =
            input.quantity > 0
                ? await this.storefrontChangeLineItemQuantity({
                      lineItemId,
                      quantity: input.quantity,
                      previousQuantity: cartLineItem.quantity,
                      removedQuantity: Math.max(cartLineItem.quantity - input.quantity, 0),
                      quantityDelta,
                      action: 'update',
                  })
                : await this.storefrontRemoveLineItemFromCart({
                      lineItemId,
                      previousQuantity: cartLineItem.quantity,
                      removedQuantity: cartLineItem.quantity,
                      quantityDelta,
                      action: 'update',
                  });

        return normalizeCart(cart);
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
            throw new Error(webMcpCartErrorMessage(response, payload));
        }

        return payload;
    }

    async findStorefrontCartLineItem(lineItemId: string): Promise<{ id: string; quantity: number } | null> {
        const currentDocumentLineItem = findCartLineItemInDocument(document, lineItemId, this.baseUrl);

        if (currentDocumentLineItem) {
            return currentDocumentLineItem;
        }

        try {
            const cart = await this.webMcpCartRequest();
            const payloadLineItem = findCartLineItemInPayload(cart, lineItemId);

            if (payloadLineItem) {
                return payloadLineItem;
            }
        } catch (error) {
            // Fall back to the storefront cart page when the optional cart endpoint is unavailable.
        }

        const cartHtml = await fetchStorefrontHtml(new URL(STOREFRONT_CART_PATH, this.baseUrl), 'Cart lookup');
        const cartDocument = parseHtmlDocument(cartHtml, 'Cart lookup');

        return findCartLineItemInDocument(cartDocument, lineItemId, this.baseUrl);
    }

    async storefrontAddProductToCart({
        productId,
        quantity,
        lineItemId,
    }: {
        productId: string;
        quantity: number;
        lineItemId: string;
    }): Promise<UnknownRecord> {
        const url = new URL(STOREFRONT_ADD_TO_CART_PATH, this.baseUrl);
        const body = createAddToCartFormBody({
            productId,
            lineItemId,
            quantity,
        });
        const csrfToken = readCsrfToken();
        const headers: Record<string, string> = {
            Accept: 'application/json, text/html, */*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
        };

        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
            body.set('_csrf_token', csrfToken);
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: body.toString(),
        });
        const payload = await parseFlexibleResponse(response);

        if (!response.ok) {
            throw new Error(storefrontErrorMessage(response, payload));
        }

        const cartWidgetRefreshed = publishCartMutation(
            {
                action: 'add',
                productId,
                quantity,
                lineItemId,
            },
            this.baseUrl,
        );

        return isPlainObject(payload)
            ? {
                  ...payload,
                  cartWidgetRefreshed,
              }
            : {
                  sessionCartUpdated: true,
                  cartWidgetRefreshed,
                  lineItems: [
                      {
                          id: lineItemId,
                          referencedId: productId,
                          type: 'product',
                          quantity,
                      },
                  ],
              };
    }

    async storefrontChangeLineItemQuantity({
        lineItemId,
        quantity,
        previousQuantity,
        removedQuantity,
        quantityDelta,
        action = 'update',
    }: {
        lineItemId: string;
        quantity: number;
        previousQuantity: number;
        removedQuantity: number;
        quantityDelta?: number;
        action?: string;
    }): Promise<UnknownRecord> {
        const url = new URL(
            `${STOREFRONT_CHANGE_LINE_ITEM_QUANTITY_PATH}/${encodeURIComponent(lineItemId)}`,
            this.baseUrl,
        );
        const body = new URLSearchParams();
        const csrfToken = readCsrfToken();
        const headers: Record<string, string> = {
            Accept: 'application/json, text/html, */*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
        };

        body.set('quantity', String(quantity));

        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
            body.set('_csrf_token', csrfToken);
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: body.toString(),
        });
        const payload = await parseFlexibleResponse(response);

        if (!response.ok) {
            throw new Error(storefrontErrorMessage(response, payload));
        }

        const cartWidgetRefreshed = publishCartMutation(
            {
                action,
                lineItemId,
                previousQuantity,
                removedQuantity,
                quantityDelta: Number.isFinite(quantityDelta) ? quantityDelta : quantity - previousQuantity,
                remainingQuantity: quantity,
                lineItemDeleted: false,
            },
            this.baseUrl,
        );

        return isPlainObject(payload)
            ? {
                  ...payload,
                  cartWidgetRefreshed,
                  lineItems:
                      normalizeLineItems(payload.lineItems).length > 0
                          ? payload.lineItems
                          : [
                                {
                                    id: lineItemId,
                                    quantity,
                                },
                            ],
              }
            : {
                  sessionCartUpdated: true,
                  cartWidgetRefreshed,
                  lineItems: [
                      {
                          id: lineItemId,
                          quantity,
                      },
                  ],
              };
    }

    async storefrontRemoveLineItemFromCart({
        lineItemId,
        previousQuantity,
        removedQuantity,
        quantityDelta,
        action = 'remove',
    }: {
        lineItemId: string;
        previousQuantity: number;
        removedQuantity: number;
        quantityDelta?: number;
        action?: string;
    }): Promise<UnknownRecord> {
        const url = new URL(`${STOREFRONT_REMOVE_FROM_CART_PATH}/${encodeURIComponent(lineItemId)}`, this.baseUrl);
        const body = new URLSearchParams();
        const csrfToken = readCsrfToken();
        const headers: Record<string, string> = {
            Accept: 'application/json, text/html, */*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
        };

        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
            body.set('_csrf_token', csrfToken);
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: body.toString(),
        });
        const payload = await parseFlexibleResponse(response);

        if (!response.ok) {
            throw new Error(storefrontErrorMessage(response, payload));
        }

        const cartWidgetRefreshed = publishCartMutation(
            {
                action,
                lineItemId,
                previousQuantity,
                removedQuantity,
                quantityDelta: Number.isFinite(quantityDelta) ? quantityDelta : -previousQuantity,
                remainingQuantity: 0,
                lineItemDeleted: true,
            },
            this.baseUrl,
        );

        return isPlainObject(payload)
            ? {
                  ...payload,
                  cartWidgetRefreshed,
              }
            : {
                  sessionCartUpdated: true,
                  cartWidgetRefreshed,
                  lineItems: [],
              };
    }
}
