import { createAddToCartFormBody, normalizeLineItems } from '../domain/cart';
import { publishCartMutation } from '../cart-ui-sync';
import { parseFlexibleResponse, storefrontErrorMessage } from '../transport/http';
import {
    STOREFRONT_ADD_TO_CART_PATH,
    STOREFRONT_CHANGE_LINE_ITEM_QUANTITY_PATH,
    STOREFRONT_REMOVE_FROM_CART_PATH,
} from '../transport/paths';
import { readCsrfToken } from '../transport/token-discovery';
import { isPlainObject } from '../tools/storefront-tool.utils';
import type { UnknownRecord } from '../types';

/**
 * Storefront cart adapter: adds/updates/removes line items through Shopware's
 * classic storefront cart routes (form-encoded + CSRF, on the shopper session) and
 * emits the best-effort UI refresh. Reads go through the Store API elsewhere; this
 * module owns the write protocol so `ShopwareClient` stays a thin orchestrator.
 */

async function storefrontCartPost(url: URL, body: URLSearchParams): Promise<unknown> {
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

    return payload;
}

export async function storefrontAddProductToCart(
    baseUrl: string,
    { productId, quantity, lineItemId }: { productId: string; quantity: number; lineItemId: string },
): Promise<UnknownRecord> {
    const url = new URL(STOREFRONT_ADD_TO_CART_PATH, baseUrl);
    const body = createAddToCartFormBody({
        productId,
        lineItemId,
        quantity,
    });
    const payload = await storefrontCartPost(url, body);

    const cartWidgetRefreshed = publishCartMutation(
        {
            action: 'add',
            productId,
            quantity,
            lineItemId,
        },
        baseUrl,
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

export async function storefrontChangeLineItemQuantity(
    baseUrl: string,
    {
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
    },
): Promise<UnknownRecord> {
    const url = new URL(`${STOREFRONT_CHANGE_LINE_ITEM_QUANTITY_PATH}/${encodeURIComponent(lineItemId)}`, baseUrl);
    const body = new URLSearchParams();
    body.set('quantity', String(quantity));

    const payload = await storefrontCartPost(url, body);

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
        baseUrl,
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

export async function storefrontRemoveLineItemFromCart(
    baseUrl: string,
    {
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
    },
): Promise<UnknownRecord> {
    const url = new URL(`${STOREFRONT_REMOVE_FROM_CART_PATH}/${encodeURIComponent(lineItemId)}`, baseUrl);
    const body = new URLSearchParams();
    const payload = await storefrontCartPost(url, body);

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
        baseUrl,
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
