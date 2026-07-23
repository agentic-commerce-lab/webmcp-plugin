import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import { isPlainObject } from './storefront-tool.utils';
import type { CartSummary, StorefrontToolOptions } from '../types';

export const GET_CART_TOOL_NAME = 'shopware_webmcp_get_cart';

const getCartInput = z.object({
    showCartOverlay: z.boolean().default(true).describe('Open the cart overlay (false = data only).'),
});

export function createGetCartTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: GET_CART_TOOL_NAME,
        title: 'Get cart',
        description: 'Returns the current cart; by default opens the cart overlay (showCartOverlay:false = data only).',
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: getCartInput,
        execute: async (input) => {
            const cart = await shopwareClient.getCart({ showCartOverlay: input.showCartOverlay });

            return {
                content: [{ type: 'text', text: formatCartResult(cart) }],
                structuredContent: { cart, shownInBrowser: cart.cartOverlayOpened ?? false },
            };
        },
    });
}

function formatCartResult(cart: CartSummary): string {
    // One-line summary; the line items live in structuredContent.cart.lineItems.
    const lineItems = Array.isArray(cart?.lineItems) ? cart.lineItems : [];

    if (lineItems.length === 0) {
        return 'Cart is empty.';
    }

    const total = formatMoney(cart?.totals?.total || cart?.totalPrice);
    const itemCount = cart.itemCount ?? lineItems.length;

    return `Cart has ${itemCount} item${itemCount === 1 ? '' : 's'}${total ? `, total ${total}` : ''} (see cart).`;
}

function formatMoney(value: unknown): string | null {
    if (!isPlainObject(value) || !Number.isFinite(value.value)) {
        return null;
    }

    return `${value.value}${value.currency ? ` ${value.currency}` : ''}`;
}
