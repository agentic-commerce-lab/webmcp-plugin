import { z } from 'zod';
import { ShopwareClient } from '../shopware-client';
import { defineTool } from './define-tool';
import type { CartSummary, StorefrontToolOptions } from '../types';

export const CLEAR_CART_TOOL_NAME = 'shopware_webmcp_clear_cart';

const clearCartInput = z.strictObject({});

export function createClearCartTool(options: StorefrontToolOptions = {}) {
    const shopwareClient = new ShopwareClient(options);

    return defineTool({
        name: CLEAR_CART_TOOL_NAME,
        title: 'Clear cart',
        description: 'Removes every item from the current cart. Takes no input.',
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        input: clearCartInput,
        execute: async () => {
            const cart = await shopwareClient.clearCart();

            return {
                content: [{ type: 'text', text: formatClearCartResult(cart) }],
                structuredContent: { cart },
            };
        },
    });
}

function formatClearCartResult(cart: CartSummary | null): string {
    const itemCount = cart?.itemCount ?? 0;

    return itemCount > 0 ? `Cart still has ${itemCount} item${itemCount === 1 ? '' : 's'}.` : 'Cart cleared.';
}
