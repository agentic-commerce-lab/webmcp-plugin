import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import type { CartSummary, StorefrontToolOptions } from '../types';

export const CLEAR_CART_TOOL_NAME = 'shopware_webmcp_clear_cart';

const clearCartInput = z.object({
    showCartOverlay: z
        .boolean()
        .default(true)
        .describe(
            'Open the storefront cart overlay after clearing so the shopper sees the empty cart. Keep it true in interactive sessions; set false for headless automation.',
        ),
});

export function createClearCartTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: CLEAR_CART_TOOL_NAME,
        title: 'Clear cart',
        description:
            'Removes every item from the current cart and, by default, opens the cart overlay so the shopper sees it is empty.',
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: clearCartInput,
        execute: async (input) => {
            const cart = await shopwareClient.clearCart({ showCartOverlay: input.showCartOverlay });

            return {
                content: [{ type: 'text', text: formatClearCartResult(cart) }],
                structuredContent: { cart, shownInBrowser: input.showCartOverlay },
            };
        },
    });
}

function formatClearCartResult(cart: CartSummary | null): string {
    const itemCount = cart?.itemCount ?? 0;

    return itemCount > 0 ? `Cart still has ${itemCount} item${itemCount === 1 ? '' : 's'}.` : 'Cart cleared.';
}
