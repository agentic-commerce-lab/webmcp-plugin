import { parseJsonResponse } from './http';

const CART_JSON_PATH = '/checkout/cart.json';
const LINE_ITEM_ADD_PATH = '/checkout/line-item/add';
const LINE_ITEM_CHANGE_QUANTITY_PATH = '/checkout/line-item/change-quantity';
const LINE_ITEM_DELETE_PATH = '/checkout/line-item/delete';

/**
 * Session-based cart transport over Shopware's stock storefront routes — the same routes
 * the storefront's own JS uses (`add-to-cart.plugin.js`). It rides the shopper's session
 * cookie, so no context token and no access key are needed and the agent operates the
 * shopper's own cart by construction. `cart.json` returns the same `CartResponse` as the
 * Store API cart route. See ADR 0004.
 */
export class StorefrontCartClient {
    constructor(private readonly baseUrl: string) {}

    /** Reads the shopper's session cart as the canonical `CartResponse`. */
    async loadCart(): Promise<unknown> {
        const response = await fetch(this.url(CART_JSON_PATH), {
            headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin',
        });
        const payload = await parseJsonResponse(response);

        if (!response.ok) {
            throw new Error(`The Shopware cart could not be read (status ${response.status}).`);
        }

        return payload;
    }

    /** Relative add — Shopware sums the quantity when the product line already exists. */
    async addProduct(productId: string, quantity: number): Promise<void> {
        const body = new URLSearchParams();
        const key = `lineItems[${productId}]`;
        body.set(`${key}[id]`, productId);
        body.set(`${key}[type]`, 'product');
        body.set(`${key}[referencedId]`, productId);
        body.set(`${key}[quantity]`, String(quantity));

        await this.write(LINE_ITEM_ADD_PATH, body);
    }

    /** Sets an existing line's quantity to an exact target (line-item id = product id). */
    async changeQuantity(productId: string, quantity: number): Promise<void> {
        await this.write(
            `${LINE_ITEM_CHANGE_QUANTITY_PATH}/${encodeURIComponent(productId)}`,
            new URLSearchParams({ quantity: String(quantity) }),
        );
    }

    async removeLineItem(productId: string): Promise<void> {
        await this.write(`${LINE_ITEM_DELETE_PATH}/${encodeURIComponent(productId)}`, new URLSearchParams());
    }

    /**
     * Removes several line items in one request via the bulk delete route
     * (`frontend.checkout.line-items.delete`). Used to clear the cart. This is preferred
     * over `/checkout/cart/delete`, which only exists in later 6.7 patches — the bulk
     * line-item delete is available across the plugin's supported Shopware range.
     */
    async removeLineItems(ids: string[]): Promise<void> {
        if (ids.length === 0) {
            return;
        }

        const body = new URLSearchParams();
        for (const id of ids) {
            body.append('ids[]', id);
        }

        await this.write(LINE_ITEM_DELETE_PATH, body);
    }

    private async write(path: string, body: URLSearchParams): Promise<void> {
        const response = await fetch(this.url(path), {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: body.toString(),
            // These routes answer with a redirect to the (HTML) cart/offcanvas; we don't
            // need the body — the caller re-reads cart.json for the authoritative state.
            // The write itself executes before the redirect is built.
            redirect: 'manual',
        });

        // An opaque redirect (status 0) is the success case; only a readable error status is a failure.
        if (response.type !== 'opaqueredirect' && !response.ok) {
            throw new Error(`The Shopware cart update failed (status ${response.status}).`);
        }
    }

    private url(path: string): string {
        return new URL(path, this.baseUrl).toString();
    }
}
